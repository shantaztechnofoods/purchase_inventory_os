// whatsapp-agent — Claude AI agent for WhatsApp training & configuration
//
// Body: { messages: [{role,content}], trainingData: string, anthropicKey: string }
//
// The agent helps the user configure WhatsApp alerts by asking smart
// questions about departments, contacts, alert rules, message formats.
// Training data (saved answers) is passed as system context so Claude
// always remembers what the user taught it.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { messages, trainingData, anthropicKey } = await req.json();

    if (!anthropicKey) return json(400, { error: "Anthropic API key chahiye — WhatsApp settings mein daalo" });
    if (!messages || !Array.isArray(messages)) return json(400, { error: "Missing messages array" });

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
        messages: messages.slice(-20), // last 20 messages for context window
      }),
    });

    const result = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error("[whatsapp-agent] Anthropic error:", resp.status, result);
      return json(resp.status, {
        error: result?.error?.message || `Anthropic API returned ${resp.status}`,
      });
    }

    const reply = result?.content?.[0]?.text || "Sorry, kuch problem aayi. Dobara try karo.";
    return json(200, { success: true, reply });
  } catch (err) {
    console.error("[whatsapp-agent] Unexpected error:", err);
    return json(500, { error: err.message || "Internal server error" });
  }
});
