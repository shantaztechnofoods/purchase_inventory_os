// Vercel serverless function — Claude AI agent for WhatsApp training & config.
//
// Deploys with the app on every push to main (no Supabase CLI). The ERP's
// WhatsApp "Training" tab calls this to chat with Claude, who asks smart
// questions to learn the business's departments, contacts and alert rules.
//
// Body: { messages: [{role,content}], trainingData: string, anthropicKey: string }
//
// Security: anthropicKey arrives in the request body from the ERP's WhatsApp
//   settings. Never stored here, never committed to git. The Anthropic call is
//   made server-side so the key is not exposed as a browser third-party request.

const SYSTEM_PROMPT = `You are a WhatsApp configuration assistant for Shantaz Technofoods ERP.
Your job is to TRAIN yourself by asking the user smart questions about their business.

You speak Hindi (Hinglish is fine). Keep answers short and practical.

YOUR GOAL: Learn everything needed to configure WhatsApp alerts perfectly.

WHAT YOU NEED TO LEARN (ask one topic at a time):
1. Department list — kitne departments hain, unke naam
2. Department heads — har department ke head ka naam aur phone number
3. Alert rules — kaunse alerts kisko jaane chahiye
   - Issue Raised → kis department ko, owner ko, ya sabko?
   - Transfer Complete → notification kis kis ko?
   - Deadline Exceeded → kitne time baad alert, kisko?
4. Message format — message mein kya kya info honi chahiye
5. Timing — raat ko message bhejein ya nahi, quiet hours?
6. Groups — kya departments ka group banana hai?
7. Daily summary — subah ka summary chahiye? kitne baje?

RULES:
- Ek baar mein ek hi topic poocho, overwhelm mat karo
- User ka answer save karne layak summary banao
- Jab ek topic complete ho, next pe jao
- Hindi mein baat karo
- Short aur crisp raho
- Jab sab training ho jaye, ek summary do ki "Maine ye sab seekha hai: ..."

TRAINING DATA (previously saved):
`;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")    { res.status(405).json({ error: "POST only" }); return; }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { messages, trainingData, anthropicKey } = body;

    if (!anthropicKey) { res.status(400).json({ error: "Anthropic API key chahiye — WhatsApp settings mein daalo" }); return; }
    if (!messages || !Array.isArray(messages)) { res.status(400).json({ error: "Missing messages array" }); return; }

    const systemPrompt = SYSTEM_PROMPT + (trainingData || "(abhi kuch nahi seekha, naya user hai)");

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages.slice(-20), // last 20 for context window
      }),
    });

    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      res.status(resp.status).json({ error: result?.error?.message || `Anthropic API returned ${resp.status}` });
      return;
    }

    const reply = result?.content?.[0]?.text || "Sorry, kuch problem aayi. Dobara try karo.";
    res.status(200).json({ success: true, reply });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
