// Vercel serverless function — inbound WhatsApp webhook with Gemini auto-reply.
//
// Chakra HQ calls this endpoint whenever a message arrives on the business
// number. It reads the ERP's own settings row for config + the operator's
// training, asks Gemini what to say, and sends the reply back on WhatsApp.
//
// Why Gemini: it reads text, images AND audio natively, so a photo of a leaking
// pump or a voice note needs no separate vision or speech-to-text service.
//
// Why no session-window problem: we only ever REPLY to someone who just messaged
// us, and their message opens WhatsApp's 24-hour window. No template needed.
//
// IMPORTANT — groups: the WhatsApp Business API never receives group messages.
// Only 1-to-1 messages to the business number reach this endpoint.
//
// Config comes from the ERP settings row (public.settings, key='org') so the
// operator edits everything in the ERP and nothing has to be redeployed:
//   waApiKey, waPluginId, waPhoneId, waGeminiKey, waAgentTraining, waAutoReply
//
// Reading that row needs Supabase credentials, which are the ONLY things that
// must exist as Vercel environment variables:
//   SUPABASE_URL                (or VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY   (or VITE_SUPABASE_ANON_KEY if RLS allows reads)

const GEMINI_MODEL = "gemini-2.0-flash";

const SYSTEM_PROMPT = `Tum Shantaz Technofoods ke official WhatsApp par jawab de rahe ho.

Tumse jo log baat kar rahe hain wo company ke employees aur departments hain.
Unke message text, photo ya voice note kuch bhi ho sakte hain.

RULES:
- Hindi/Hinglish mein, simple aur short jawab do. Factory ke log padh rahe hain.
- Sirf wahi batao jo tumhe training mein sikhaya gaya hai.
- Agar koi aisi baat poochhi jaye jo training mein nahi hai, ya jo decision owner
  ka hai (paisa, order, kisi ko kaam dena), to khud faisla mat karo —
  politely bolo ki tum owner ko bata doge.
- Photo aaye to usme jo dikh raha hai uske hisaab se jawab do.
- Voice note aaye to usme jo kaha gaya hai uske hisaab se jawab do.
- Kabhi mat kaho ki tum ek AI ho ya tumhe "training" di gayi hai.
- Jhooth mat bolo. Pata na ho to saaf bolo ki pata karke batate hain.

OWNER KI DI HUI TRAINING (ismein jo likha hai wahi tumhara asli instruction hai):
`;

// ── settings ──────────────────────────────────────────────────────────────
async function loadErpSettings() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return { error: "Supabase env vars missing (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" };

  const resp = await fetch(`${url}/rest/v1/settings?key=eq.org&select=value`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!resp.ok) return { error: `settings read failed (${resp.status})` };
  const rows = await resp.json().catch(() => []);
  return { settings: rows?.[0]?.value || {} };
}

// ── inbound event parsing ─────────────────────────────────────────────────
// Chakra's webhook payload shape varies by event, so pull the few fields we
// need defensively rather than assuming one layout.
function parseInbound(body) {
  const m = body?.message || body?.data?.message || body?._data?.message || body?.data || body || {};
  const direction = String(m?.direction || body?.direction || "").toLowerCase();
  const text =
    m?.text ||
    m?.body?.text?.body ||
    body?.text ||
    "";
  const attachments = Array.isArray(m?.attachments) ? m.attachments
                    : Array.isArray(body?.attachments) ? body.attachments : [];
  const from =
    m?.from ||
    body?.from ||
    body?.chat?.primaryContactHandle?.value ||
    m?.chat?.primaryContactHandle?.value ||
    body?.providerHandle ||
    "";
  return { direction, text: String(text || ""), attachments, from: String(from || "") };
}

// Download a media attachment and return it as inline base64 for Gemini.
// Anything we cannot fetch is skipped rather than failing the whole reply.
async function fetchInlineMedia(att, apiKey) {
  const url = att?.url || att?.link || att?.mediaUrl || "";
  if (!url) return null;
  try {
    const resp = await fetch(url, { headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} });
    if (!resp.ok) return null;
    const mimeType = att?.mimeType || att?.contentType || resp.headers.get("content-type") || "application/octet-stream";
    // Only media Gemini can actually read.
    if (!/^(image|audio|video)\//.test(mimeType)) return null;
    const buf = Buffer.from(await resp.arrayBuffer());
    // Keep well inside the request limit; a long voice note is still fine.
    if (buf.length > 15 * 1024 * 1024) return null;
    return { inlineData: { mimeType: mimeType.split(";")[0], data: buf.toString("base64") } };
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  // Chakra may probe the endpoint with a GET before enabling it.
  if (req.method === "GET")     { res.status(200).json({ ok: true }); return; }
  if (req.method !== "POST")    { res.status(405).json({ error: "POST only" }); return; }

  // Always answer 200 quickly. A webhook that returns an error gets retried or
  // disabled by the provider, and none of our failure modes are worth that.
  const done = (info) => res.status(200).json({ ok: true, ...info });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const inbound = parseInbound(body);

    // Never answer our own outbound messages — that would loop.
    if (inbound.direction === "outbound") return done({ skipped: "outbound" });
    if (!inbound.from)                    return done({ skipped: "no sender" });
    if (!inbound.text && inbound.attachments.length === 0) return done({ skipped: "empty" });

    const { settings, error: sErr } = await loadErpSettings();
    if (sErr) return done({ skipped: sErr });

    if (!settings.waAutoReply)  return done({ skipped: "auto-reply off" });
    if (!settings.waGeminiKey)  return done({ skipped: "no gemini key" });
    if (!settings.waApiKey)     return done({ skipped: "no chakra key" });

    // ── Build the Gemini request: text + any image/audio inline ──
    const parts = [];
    if (inbound.text) parts.push({ text: inbound.text });
    for (const att of inbound.attachments.slice(0, 4)) {
      const media = await fetchInlineMedia(att, settings.waApiKey);
      if (media) parts.push(media);
    }
    if (parts.length === 0) return done({ skipped: "nothing readable" });

    const gResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": settings.waGeminiKey },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT + (settings.waAgentTraining || "(abhi koi training nahi di gayi)") }],
          },
          contents: [{ role: "user", parts }],
          generationConfig: { maxOutputTokens: 600, temperature: 0.6 },
        }),
      },
    );
    const gJson = await gResp.json().catch(() => ({}));
    if (!gResp.ok) return done({ skipped: `gemini ${gResp.status}`, detail: gJson?.error?.message });

    const reply = (gJson?.candidates?.[0]?.content?.parts || [])
      .map((p) => p?.text).filter(Boolean).join("").trim();
    if (!reply) return done({ skipped: "empty reply" });

    // ── Send it back. Session message: their message opened the 24h window. ──
    const phone = inbound.from.replace(/[\s+\-()]/g, "");
    const sendResp = await fetch(
      `https://api.chakrahq.com/v1/ext/plugin/whatsapp/${settings.waPluginId}/api/v21.0/${settings.waPhoneId}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${settings.waApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "text",
          text: { body: reply },
        }),
      },
    );
    const sendJson = await sendResp.json().catch(() => ({}));
    if (!sendResp.ok) return done({ replied: false, error: sendJson?._errors?.[0] || `send ${sendResp.status}` });

    return done({ replied: true, to: phone });
  } catch (err) {
    return done({ error: err?.message || "handler threw" });
  }
}
