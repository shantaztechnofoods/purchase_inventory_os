// Vercel serverless function — inbound WhatsApp webhook with Gemini auto-reply.
//
// Runs 24x7 on the server: Chakra HQ calls this whenever a message arrives on
// the business number, so nothing needs the ERP or any computer to be open.
//
// Flow: Chakra -> here -> read ERP settings -> (download media) -> Gemini ->
//       send the reply back on WhatsApp.
//
// Gemini reads text, images AND audio natively, so a photo of a leaking pump or
// a voice note needs no separate vision or speech-to-text service.
//
// No message template is needed: we only ever REPLY to someone who just
// messaged us, and their message opens WhatsApp's 24-hour session window.
//
// Groups: the WhatsApp Business API never delivers group messages. Only 1-to-1
// messages to the business number reach this endpoint.
//
// ── Configuration ─────────────────────────────────────────────────────────
// Everything the operator can change lives in the ERP's own settings row
// (public.settings, key='org'), so it is edited in the ERP and never needs a
// redeploy: waApiKey, waPluginId, waPhoneId, waGeminiKey, waAgentTraining,
// waAutoReply.
//
// Only the Supabase credentials must exist as Vercel environment variables,
// because they are what lets this function read that row:
//   SUPABASE_URL                (or VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY   (or VITE_SUPABASE_ANON_KEY if RLS allows reads)
// Optional:
//   CHAKRA_WEBHOOK_SECRET       HMAC secret from Chakra Admin > Team > Secrets.
//                               When set, every call must carry a valid
//                               X-Chakra-Signature-256 or it is rejected.

import crypto from "node:crypto";

// Raw body is required for HMAC: the signature is computed over the exact bytes
// Chakra sent, so a parsed-and-reserialised object would not match.
export const config = { api: { bodyParser: false } };

// Google has moved new accounts off generateContent: every older model answers
// "no longer available to new users ... we recommend the Interactions API".
// So this calls /v1beta/interactions, which is also simpler — one input array
// carrying text, images and audio together.
const GEMINI_URL    = "https://generativelanguage.googleapis.com/v1beta/interactions";
// Ordered by what actually answers. gemini-3.8-flash is the model Google's own
// errors recommend, but on this account it returns 503 "high demand" or simply
// never responds, so it sits last. The first two were measured replying in
// about a second. Each is tried in turn, because an overloaded model is a
// temporary condition and the next one usually answers immediately.
const GEMINI_MODELS = ["gemini-3-flash-preview", "gemini-3.1-flash-lite", "gemini-3.8-flash"];
const GEMINI_ATTEMPT_MS = 12000;
const WA_API_VERSION = "v21.0";
const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

const SYSTEM_PROMPT = `Tum Shantaz Technofoods ke official WhatsApp par jawab de rahe ho.

Tumse baat karne wale company ke employees aur departments hain. Unke message
text, photo ya voice note kuch bhi ho sakte hain.

RULES:
- Hindi/Hinglish mein, short aur simple jawab do. Factory ke log padh rahe hain.
- Sirf wahi batao jo niche di gayi training mein hai.
- Jo baat training mein nahi hai, ya jo faisla owner ka hai (paisa, order,
  kisi ko kaam dena, kuch mangwana) — us par khud faisla mat karo. Politely
  bolo ki tum owner ko bata doge.
- Photo aaye to usme jo dikh raha hai uske hisaab se jawab do.
- Voice note aaye to usme jo kaha gaya hai uske hisaab se jawab do.
- Kabhi mat kaho ki tum AI ho ya tumhe training di gayi hai.
- Jhooth mat bolo. Pata na ho to saaf bolo ki pata karke batate hain.

OWNER KI DI HUI TRAINING (yahi tumhara asli instruction hai):
`;

// Short-lived guard against the same message being handled twice if Chakra
// retries. Per warm instance only — a cold start forgets, which is acceptable:
// the cost of a rare duplicate reply is far lower than the cost of storing
// state on every message.
const seen = new Map();
function alreadyHandled(id) {
  if (!id) return false;
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > 10 * 60 * 1000) seen.delete(k);
  if (seen.has(id)) return true;
  seen.set(id, now);
  return false;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function signatureValid(raw, header, secret) {
  if (!secret) return true;                       // verification not configured
  if (!header) return false;
  try {
    const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(String(header).trim().replace(/^sha256=/, ""), "utf8");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ── ERP settings ──────────────────────────────────────────────────────────
async function loadErpSettings() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return { error: "Supabase env vars missing (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" };
  try {
    const resp = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/settings?key=eq.org&select=value`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!resp.ok) return { error: `settings read failed (HTTP ${resp.status})` };
    const rows = await resp.json().catch(() => []);
    return { settings: rows?.[0]?.value || {} };
  } catch (e) {
    return { error: `settings read threw: ${e?.message || e}` };
  }
}

// ── Payload parsing ───────────────────────────────────────────────────────
// Chakra can be configured to send EITHER format, so both are supported and
// the operator's choice in "WhatsApp Setup > More" cannot break this endpoint.
//
// Returns { skip } for anything that must not be answered, otherwise
// { id, from, text, media: [{ kind, mediaId, mimeType }] }.
export function parseInbound(body) {
  // ---- Chakra Events format: { event, payload } ----
  if (body && typeof body.event === "string") {
    const ev = body.event;
    // 'status' is a delivery receipt; the *_echo events are OUR OWN outbound
    // messages echoed back. Answering an echo would make the bot reply to
    // itself forever, so these are dropped before anything else happens.
    if (ev !== "message") return { skip: `event=${ev}` };
    const p   = body.payload || {};
    const msg = p.message || p;
    return extractMessage(msg, p.messageId || p.externalId || msg.id);
  }

  // ---- Meta pass-through format: { entry: [ { changes: [ { value } ] } ] } ----
  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    for (const change of (Array.isArray(entry?.changes) ? entry.changes : [])) {
      const value = change?.value || {};
      // Delivery/read receipts arrive here too — not something to answer.
      if (Array.isArray(value.statuses) && value.statuses.length) continue;
      const msg = Array.isArray(value.messages) ? value.messages[0] : null;
      if (msg) return extractMessage(msg, msg.id);
    }
  }
  return { skip: "no message in payload" };
}

function extractMessage(msg, id) {
  if (!msg || typeof msg !== "object") return { skip: "no message object" };
  const from = String(msg.from || msg.wa_id || "").trim();
  if (!from) return { skip: "no sender" };

  const type = String(msg.type || (msg.text ? "text" : "")).toLowerCase();
  let text = "";
  const media = [];

  if (msg.text) text = msg.text.body || msg.text || "";

  // Media arrives as an ID plus a mime type — never as a file or URL.
  for (const kind of ["image", "audio", "voice", "video", "document", "sticker"]) {
    const m = msg[kind];
    if (m && m.id) {
      media.push({ kind, mediaId: String(m.id), mimeType: m.mime_type || m.mimeType || "" });
      if (m.caption && !text) text = m.caption;
    }
  }

  if (!text && media.length === 0) return { skip: `unsupported type=${type || "unknown"}` };
  return { id: id ? String(id) : "", from, text: String(text || ""), media };
}

// ── Media download ────────────────────────────────────────────────────────
// Chakra's media endpoint REDIRECTS to the real file. The Authorization header
// must not travel to that redirect target (a signed URL rejects it), so the
// redirect is followed manually and the second request is sent bare.
async function downloadMedia(mediaId, apiKey) {
  const url = `https://api.chakrahq.com/v2/whatsapp/${WA_API_VERSION}/media/${encodeURIComponent(mediaId)}/show`;
  let resp = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: "manual",
  });

  if (resp.status >= 300 && resp.status < 400) {
    const location = resp.headers.get("location");
    if (!location) return null;
    resp = await fetch(location);          // deliberately no auth header
  }
  if (!resp.ok) return null;

  const mimeType = (resp.headers.get("content-type") || "").split(";")[0];
  const buf = Buffer.from(await resp.arrayBuffer());
  if (!buf.length || buf.length > MAX_MEDIA_BYTES) return null;
  return { buf, mimeType };
}

// Gemini only accepts media it can actually read.
function geminiMime(declared, sniffed, kind) {
  const m = (declared || sniffed || "").split(";")[0].toLowerCase();
  if (/^(image|audio|video)\//.test(m)) return m;
  if (kind === "image") return "image/jpeg";
  if (kind === "audio" || kind === "voice") return "audio/ogg";
  return null;
}

// ── Handler ───────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  // Chakra probes the endpoint before enabling it.
  if (req.method === "GET")     { res.status(200).json({ ok: true, service: "whatsapp-webhook" }); return; }
  if (req.method !== "POST")    { res.status(405).json({ error: "POST only" }); return; }

  // A webhook that answers with an error gets retried, then disabled by the
  // provider. None of our failure modes are worth losing the subscription, so
  // every path below answers 200 and says WHY in the body (visible in Chakra's
  // Webhook Logs, which is where this gets debugged from).
  const done = (info) => { res.status(200).json({ ok: true, ...info }); };

  let raw;
  try {
    raw = await readRawBody(req);
  } catch (e) {
    return done({ skipped: `body read failed: ${e?.message || e}` });
  }

  const secret = process.env.CHAKRA_WEBHOOK_SECRET || "";
  if (!signatureValid(raw, req.headers["x-chakra-signature-256"], secret)) {
    // This one IS a real rejection: an unsigned call is not from Chakra.
    res.status(401).json({ error: "bad signature" });
    return;
  }

  let body;
  try {
    body = JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    return done({ skipped: "body is not JSON" });
  }

  try {
    const inbound = parseInbound(body);
    if (inbound.skip) return done({ skipped: inbound.skip });
    if (alreadyHandled(inbound.id)) return done({ skipped: "duplicate delivery" });

    const { settings, error: sErr } = await loadErpSettings();
    if (sErr) return done({ skipped: sErr });

    if (!settings.waAutoReply) return done({ skipped: "auto-reply is off in ERP settings" });
    if (!settings.waGeminiKey) return done({ skipped: "no Gemini key in ERP settings" });
    if (!settings.waApiKey)    return done({ skipped: "no Chakra API key in ERP settings" });
    if (!settings.waPluginId || !settings.waPhoneId) return done({ skipped: "plugin/phone id missing in ERP settings" });

    // ── Assemble what Gemini sees: the text plus any readable media ──
    // Interactions takes one flat `input` array of typed items, so a photo and
    // a voice note travel beside the text instead of in a separate structure.
    const input = [];
    if (inbound.text) input.push({ type: "text", text: inbound.text });

    const mediaNotes = [];
    for (const m of inbound.media.slice(0, 3)) {
      const file = await downloadMedia(m.mediaId, settings.waApiKey);
      if (!file) { mediaNotes.push(`${m.kind}: download failed`); continue; }
      const mime = geminiMime(m.mimeType, file.mimeType, m.kind);
      if (!mime) { mediaNotes.push(`${m.kind}: unsupported type`); continue; }
      input.push({
        type: mime.startsWith("image/") ? "image" : mime.startsWith("audio/") ? "audio" : "video",
        mime_type: mime,
        data: file.buf.toString("base64"),
      });
    }

    if (input.length === 0) {
      return done({ skipped: `nothing readable${mediaNotes.length ? ` (${mediaNotes.join("; ")})` : ""}` });
    }

    // ── Ask Gemini ──
    // store:false keeps this stateless — we hold no conversation on Google's
    // side, and each WhatsApp message is answered on its own.
    let gJson, lastErr = "";
    for (const model of GEMINI_MODELS) {
      try {
        const gResp = await fetch(GEMINI_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": settings.waGeminiKey },
          body: JSON.stringify({
            model,
            system_instruction: SYSTEM_PROMPT + (settings.waAgentTraining || "(abhi koi training nahi di gayi hai)"),
            input,
            store: false,
          }),
          // Bound EACH attempt, not the whole loop: a model that hangs must
          // cost one short wait and hand over to the next, not the entire
          // budget. Chakra is waiting on this response, and a serverless
          // function that never returns is killed without saying why.
          signal: AbortSignal.timeout(GEMINI_ATTEMPT_MS),
        });
        const j = await gResp.json().catch(() => ({}));
        if (gResp.ok) { gJson = j; break; }
        lastErr = `${model}: HTTP ${gResp.status} ${j?.error?.message || ""}`.trim();
        // 404/400 = wrong or retired model, 429/503 = busy right now. Both are
        // worth trying the next model for. Anything else (a bad key, a blocked
        // request) would fail identically on every model, so stop.
        if (![400, 404, 429, 503].includes(gResp.status)) break;
      } catch (e) {
        // A timeout or network error on one model — try the next.
        lastErr = `${model}: ${e?.message || e}`;
      }
    }
    if (!gJson) return done({ skipped: "gemini unavailable", detail: lastErr });

    // Interactions answers with steps[]; the reply is the text content of the
    // model_output step. Several steps can carry text, so they are joined.
    const reply = (Array.isArray(gJson?.steps) ? gJson.steps : [])
      .filter((s) => s?.type === "model_output")
      .flatMap((s) => (Array.isArray(s?.content) ? s.content : []))
      .filter((c) => c?.type === "text")
      .map((c) => c.text)
      .filter(Boolean)
      .join("")
      .trim();
    if (!reply) {
      // Usually a safety block or an unfinished interaction — worth logging.
      return done({ skipped: "gemini returned no text", interactionStatus: gJson?.status });
    }

    // ── Send the reply (session message — their message opened the window) ──
    const phone = inbound.from.replace(/[\s+\-()]/g, "");
    try {
      const sendResp = await fetch(
        `https://api.chakrahq.com/v1/ext/plugin/whatsapp/${settings.waPluginId}/api/${WA_API_VERSION}/${settings.waPhoneId}/messages`,
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
      if (!sendResp.ok) {
        return done({ replied: false, error: sendJson?._errors?.[0] || sendJson?.error?.message || `send HTTP ${sendResp.status}` });
      }
      return done({ replied: true, to: phone, chars: reply.length });
    } catch (e) {
      return done({ replied: false, error: `send failed: ${e?.message || e}` });
    }
  } catch (err) {
    return done({ error: `handler threw: ${err?.message || err}` });
  }
}
