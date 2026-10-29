// whatsapp-send — Secure WhatsApp message relay via Chakra HQ API
// Body: { to, message, apiKey, phoneId }
//
// The API key is passed from the client (stored in ERP settings) and
// forwarded to Chakra HQ. In production, the key should move to
// Supabase secrets (WHATSAPP_API_KEY env var) so the client never
// touches it. For now, the client-supplied key is accepted.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { to, message, apiKey, phoneId } = await req.json();

    if (!to || !message) return json(400, { error: "Missing 'to' or 'message'" });
    if (!apiKey)         return json(400, { error: "Missing 'apiKey' — configure in Settings → Notifications" });

    // Normalize phone: strip +, spaces, dashes
    const phone = String(to).replace(/[\s+\-()]/g, "");
    if (!/^\d{10,15}$/.test(phone)) return json(400, { error: `Invalid phone number: ${phone}` });

    // ── Chakra HQ API call ──
    // Chakra HQ uses the standard WhatsApp Cloud API format as a Meta BSP.
    // Endpoint: https://waba.chakrahq.com/v1/messages
    // If Chakra HQ's actual endpoint differs, update the URL below.
    const CHAKRA_API_URL = "https://waba.chakrahq.com/v1/messages";

    const payload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body: message },
    };

    const resp = await fetch(CHAKRA_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      console.error("[whatsapp-send] Chakra HQ error:", resp.status, result);
      return json(resp.status, {
        error: result?.error?.message || result?.message || `Chakra HQ returned ${resp.status}`,
        details: result,
      });
    }

    return json(200, { success: true, messageId: result?.messages?.[0]?.id || null });
  } catch (err) {
    console.error("[whatsapp-send] Unexpected error:", err);
    return json(500, { error: err.message || "Internal server error" });
  }
});
