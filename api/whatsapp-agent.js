// Vercel serverless function — the training chat for the WhatsApp auto-reply
// agent, backed by Gemini.
//
// Gemini rather than Anthropic because the same key then powers the live
// auto-reply webhook, and Gemini reads text, images AND audio natively — a
// WhatsApp voice note needs no separate speech-to-text service.
//
// This endpoint is where the operator TEACHES the agent. The webhook
// (whatsapp-webhook.js) is where the agent answers real customers using what
// was taught here.
//
// Body: { messages: [{role, content}], trainingData, geminiKey }
// Out:  { success, reply }
//
// The key arrives in the request body from the ERP's WhatsApp settings and is
// used server-side only — never committed, never a browser third-party call.

import { SYSTEM_PROMPT as REPLY_PROMPT, GEMINI_MODELS } from "./whatsapp-webhook.js";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const MODEL      = "gemini-3-flash-preview";

// One Gemini call, trying each model in turn on the errors that mean "busy or
// gone" — the same order and rule the live webhook uses, so a test here
// behaves like the real thing.
async function askGemini(geminiKey, system, text) {
  let lastErr = "No reply from Gemini";
  for (const model of GEMINI_MODELS) {
    try {
      const r = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
        body: JSON.stringify({ model, system_instruction: system, input: [{ type: "text", text }], store: false }),
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) {
        const out = (Array.isArray(j?.steps) ? j.steps : [])
          .filter((st) => st?.type === "model_output")
          .flatMap((st) => (Array.isArray(st?.content) ? st.content : []))
          .filter((c) => c?.type === "text").map((c) => c.text).join("").trim();
        if (out) return { ok: true, text: out };
      }
      lastErr = j?.error?.message || `Gemini returned ${r.status}`;
      if (![400, 404, 429, 503].includes(r.status) && r.ok === false) break;
    } catch (e) {
      lastErr = e?.name === "TimeoutError" ? "Gemini did not reply in time" : (e?.message || lastErr);
    }
  }
  return { ok: false, error: lastErr };
}

// The interview: Gemini plays the trainer and asks the owner about ONE
// situation the agent does not yet know how to handle, with ready answers to
// pick from. Picking is faster than typing on a factory floor, and the answer
// becomes one rule.
const INTERVIEW_PROMPT = `Tum Shantaz Technofoods ke owner ki madad kar rahe ho apne WhatsApp auto-reply agent ko sikhane mein.

Company ka WhatsApp INTERNAL hai: production floor ke employees aur departments
(Mechanical, Electrical, Packing, Store, Assembly waghera) is number par message
karte hain — machine ka issue, transfer, stock, chhutti, photo, voice note.

Tumhe EK naya sawaal poochhna hai: ek aisi asli situation jo neeche ke rules
mein abhi cover NAHI hai, aur jo factory mein sach mein aati hai. Phir agent
us situation mein kya kare, uske 3 alag, practical jawab suggest karo — har
jawab chhota (1-2 line), Hinglish mein, wahi baat jo agent bolega ya karega.
Teeno jawab ek doosre se sach mein alag hon (jaise: khud jawab de / owner ko
bata de / zaroori jaankari maange).

Sirf ye JSON do, aur kuch nahi:
{"situation":"<chhoti situation, 'Jab ...' se shuru>","question":"<owner se sawaal>","options":["...","...","..."]}`;

export function parseInterview(text) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const options = (Array.isArray(j?.options) ? j.options : []).map((o) => String(o).trim()).filter(Boolean).slice(0, 4);
    if (!j?.situation || !j?.question || options.length < 2) return null;
    return { situation: String(j.situation).trim(), question: String(j.question).trim(), options };
  } catch { return null; }
}

const SYSTEM_PROMPT = `Tum Shantaz Technofoods ke WhatsApp auto-reply agent ho.

Is chat mein tumhara kaam SEEKHNA hai — owner tumhe sikhayega ki WhatsApp par
aane wale messages ka kya jawab dena hai. Baad mein tum asli customers/employees
ko inhi rules ke hisaab se jawab doge.

TUMHARA KAAM IS TRAINING CHAT MEIN:
- Owner se smart sawaal poochho taaki tum achhe se seekh sako
- Ek baar mein ek hi topic, overwhelm mat karo
- Jo seekha use short summary mein confirm karo
- Hindi/Hinglish mein baat karo, simple rakho

KYA-KYA SEEKHNA HAI (ek-ek karke):
1. Business kya karta hai, kaun log message karenge (employees, departments)
2. Common sawaal kya aate hain aur unka sahi jawab kya hai
3. Machine/production se judi baat aaye to kya karna hai
4. Photo aaye (jaise machine ka fault) to kaise react karna hai
5. Voice note aaye to kaise handle karna hai
6. Kab jawab dena hai aur kab "owner ko bata dunga" bolna hai
7. Tone — formal ya casual, kaunsi bhasha

RULES:
- Jo training pehle se saved hai use yaad rakho, dobara mat poochho
- Short aur crisp raho
- Jab kaafi seekh lo to summary do: "Maine ye seekha hai: ..."

ABHI TAK KI SAVED TRAINING:
`;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")    { res.status(405).json({ error: "POST only" }); return; }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { messages, trainingData, geminiKey, listModels } = body;

    if (!geminiKey) { res.status(400).json({ error: "Add the Gemini API key in WhatsApp Settings" }); return; }

    // Test: the reply the live webhook WOULD send for this message, with the
    // same prompt and the same rules — but nothing goes out on WhatsApp.
    if (body.mode === "test") {
      const msg = String(body.message || "").trim();
      if (!msg) { res.status(400).json({ error: "Type a test message" }); return; }
      const r = await askGemini(geminiKey, REPLY_PROMPT + (trainingData || "(abhi koi training nahi)"), msg);
      if (!r.ok) { res.status(502).json({ error: r.error }); return; }
      res.status(200).json({ success: true, reply: r.text });
      return;
    }

    if (body.mode === "interview") {
      const asked = (Array.isArray(body.asked) ? body.asked : []).slice(-30);
      const input =
        `ABHI TAK KE RULES:\n${trainingData || "(koi nahi)"}\n\n` +
        `YE SITUATIONS PEHLE POOCHHI JA CHUKI HAIN, DOBARA MAT POOCHHO:\n${asked.join("\n") || "(koi nahi)"}`;
      // One retry: a model occasionally wraps the JSON in prose or skips a field.
      for (let i = 0; i < 2; i++) {
        const r = await askGemini(geminiKey, INTERVIEW_PROMPT, input);
        if (!r.ok) { res.status(502).json({ error: r.error }); return; }
        const q = parseInterview(r.text);
        if (q) { res.status(200).json({ success: true, ...q }); return; }
      }
      res.status(502).json({ error: "Could not prepare a question, try again" });
      return;
    }

    // Smallest possible generateContent call, time-bound, reporting the raw
    // status. listModels (a GET) succeeds while generateContent (a POST) hangs,
    // so this isolates whether the POST itself is refused, slow, or blocked —
    // something the normal path can only report as "timed out".
    if (body.pingModel) {
      const t0 = Date.now();
      try {
        const pr = await fetch(GEMINI_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
          body: JSON.stringify({ model: body.pingModel, input: "say ok", store: false }),
          signal: AbortSignal.timeout(12000),
        });
        const pj = await pr.json().catch(() => ({}));
        res.status(200).json({
          success: true, ms: Date.now() - t0, status: pr.status,
          text: (Array.isArray(pj?.steps) ? pj.steps : [])
            .filter((s) => s?.type === "model_output")
            .flatMap((s) => s?.content || [])
            .filter((c) => c?.type === "text").map((c) => c.text).join("") || null,
          error: pj?.error?.message || null,
        });
      } catch (e) {
        res.status(200).json({ success: false, ms: Date.now() - t0, threw: String(e?.message || e) });
      }
      return;
    }

    // Model names get retired (gemini-2.0-flash already was), and the error
    // only shows up at the moment someone is waiting for a reply. This asks
    // Google which models the key can actually use.
    if (listModels) {
      const lr = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
        headers: { "x-goog-api-key": geminiKey },
        signal: AbortSignal.timeout(15000),
      });
      const lj = await lr.json().catch(() => ({}));
      res.status(200).json({
        success: true,
        status: lr.status,
        models: (lj?.models || [])
          .filter((m) => (m?.supportedGenerationMethods || []).includes("generateContent"))
          .map((m) => m.name),
        error: lj?.error?.message || null,
      });
      return;
    }
    if (!messages || !Array.isArray(messages)) { res.status(400).json({ error: "Missing messages array" }); return; }

    const systemPrompt = SYSTEM_PROMPT + (trainingData || "(abhi kuch nahi seekha, naya setup hai)");

    // Interactions can carry a conversation server-side via
    // previous_interaction_id, but that requires storing it on Google's side.
    // The training chat already holds its own history, so the turns are
    // flattened into one stateless input instead.
    const transcript = messages.slice(-20)
      .map((m) => `${m.role === "assistant" ? "Tum" : "Owner"}: ${String(m.content || "")}`)
      .join("\n");

    const resp = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify({
        model: MODEL,
        system_instruction: systemPrompt,
        input: [{ type: "text", text: transcript }],
        store: false,
      }),
      signal: AbortSignal.timeout(25000),
    });

    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      res.status(resp.status).json({ error: result?.error?.message || `Gemini returned ${resp.status}` });
      return;
    }

    const reply = (Array.isArray(result?.steps) ? result.steps : [])
      .filter((s) => s?.type === "model_output")
      .flatMap((s) => (Array.isArray(s?.content) ? s.content : []))
      .filter((c) => c?.type === "text")
      .map((c) => c.text)
      .filter(Boolean)
      .join("")
      || "Something went wrong. Try again.";
    res.status(200).json({ success: true, reply });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
