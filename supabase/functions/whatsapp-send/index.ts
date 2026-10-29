// whatsapp-send — Secure WhatsApp message relay via Chakra HQ API
//
// Supports TWO modes:
//   1. Template message (outbound, no 24h window needed):
//      { to, templateName, mapping?, apiKey, pluginId, phoneNumberId }
//   2. Session message (only within 24h of user's last message):
//      { to, message, apiKey, pluginId, phoneNumberId }
//
// pluginId = Chakra HQ WhatsApp plugin UUID
// phoneNumberId = WhatsApp Phone Number ID from Chakra HQ

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
    const body = await req.json();
    const { to, message, templateName, mapping, apiKey, pluginId, phoneId } = body;

    if (!to)       return json(400, { error: "Missing 'to'" });
    if (!apiKey)   return json(400, { error: "Missing 'apiKey' — WhatsApp page में configure करो" });
    if (!pluginId) return json(400, { error: "Missing 'pluginId' — WhatsApp page में configure करो" });

    // Normalize phone: strip +, spaces, dashes
    const phone = String(to).replace(/[\s+\-()]/g, "");
    if (!/^\d{10,15}$/.test(phone)) return json(400, { error: `Invalid phone number: ${phone}` });

    const BASE = "https://api.chakrahq.com/v1/ext/plugin/whatsapp";
    const headers = {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    };

    // ── MODE 1: Template Message (outbound alerts — no 24h window needed) ──
    if (templateName) {
      const url = `${BASE}/${pluginId}/phoneNumber/${phone}/send-template-message`;
      const payload: Record<string, unknown> = {
        whatsappPhoneNumberId: phoneId || "",
        templateName,
      };
      if (mapping && Array.isArray(mapping)) {
        payload.mapping = mapping;
      }
      if (body.imageUrl)    payload.imageUrl = body.imageUrl;
      if (body.videoUrl)    payload.videoUrl = body.videoUrl;
      if (body.documentUrl) payload.documentUrl = body.documentUrl;
      if (body.language)    payload.language = body.language;

      const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
      const result = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        console.error("[whatsapp-send] Template error:", resp.status, result);
        return json(resp.status, {
          error: result?._errors?.[0] || result?.error?.message || `Chakra HQ returned ${resp.status}`,
          details: result,
        });
      }
      return json(200, {
        success: true,
        messageId: result?._data?.externalId || result?._data?.id || null,
        deliveryStatus: result?._data?.deliveryStatus || null,
      });
    }

    // ── MODE 2: Session Message (free-form text, 24h window required) ──
    if (message) {
      const apiVersion = "v21.0";
      const url = `${BASE}/${pluginId}/api/${apiVersion}/${phoneId}/messages`;
      const payload = {
        messaging_product: "whatsapp",
        to: phone,
        type: "text",
        text: { body: message },
      };

      const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
      const result = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        console.error("[whatsapp-send] Session error:", resp.status, result);
        return json(resp.status, {
          error: result?._errors?.[0] || result?.error?.message || `Chakra HQ returned ${resp.status}`,
          details: result,
        });
      }
      return json(200, {
        success: true,
        messageId: result?._data?.whatsappMessageId || result?._data?.id || null,
      });
    }

    return json(400, { error: "Provide either 'message' (session) or 'templateName' (template)" });
  } catch (err) {
    console.error("[whatsapp-send] Unexpected error:", err);
    return json(500, { error: err.message || "Internal server error" });
  }
});
