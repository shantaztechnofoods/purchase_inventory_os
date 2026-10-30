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

const MODEL = "gemini-flash-latest";

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

    if (!geminiKey) { res.status(400).json({ error: "Gemini API key chahiye — WhatsApp Settings mein daalo" }); return; }

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

    // Gemini uses "model" where chat APIs usually say "assistant".
    const contents = messages.slice(-20).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: String(m.content || "") }],
    }));

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents,
          generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
        }),
      },
    );

    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      res.status(resp.status).json({ error: result?.error?.message || `Gemini returned ${resp.status}` });
      return;
    }

    const reply = result?.candidates?.[0]?.content?.parts?.map((p) => p?.text).filter(Boolean).join("")
      || "Sorry, kuch problem aayi. Dobara try karo.";
    res.status(200).json({ success: true, reply });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
