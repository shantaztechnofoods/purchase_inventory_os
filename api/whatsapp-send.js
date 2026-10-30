// Vercel serverless function — WhatsApp message relay via Chakra HQ API.
//
// Why this exists (and not only supabase/functions/whatsapp-send):
//   The ERP deploys to Vercel on every push to main. A file in /api is picked
//   up by Vercel as a serverless endpoint automatically — no Supabase CLI, no
//   separate deploy step — so this is the path that is actually live in
//   production. The Supabase Edge Function version is kept as a reference and
//   as an alternative server-side relay, but the app calls THIS one.
//
// Security: the Chakra HQ API key arrives in the request body from the ERP's
//   WhatsApp settings (stored in the DB / localStorage at runtime). It is NEVER
//   stored in this file or committed to git. The call to Chakra HQ happens
//   server-side here, so the key is not exposed to the browser's network tab
//   as a third-party request.
//
// Two modes (same contract as the Edge Function):
//   1. Template message (outbound, no 24h window):
//        { to, templateName, mapping?, apiKey, pluginId, phoneId }
//   2. Session message (free-form text, within 24h of user's last message):
//        { to, message, apiKey, pluginId, phoneId }

// Meta refuses a template parameter that contains a newline, a tab or more
// than four spaces in a row — and refuses the WHOLE message, not just that
// slot. An issue description typed on the floor can easily contain any of
// these, so every value is flattened before it goes out.
export function cleanParam(v) {
  const t = String(v ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return (t || "-").slice(0, 300);
}

// The standard WhatsApp Cloud API template message, sent through the same
// Chakra pass-through the plain-text path already uses successfully.
export function buildTemplatePayload(phone, tpl) {
  const params = (Array.isArray(tpl?.params) ? tpl.params : []).map((v) => ({ type: "text", text: cleanParam(v) }));
  return {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: {
      name: tpl.name,
      language: { code: tpl.language || "en" },
      ...(params.length ? { components: [{ type: "body", parameters: params }] } : {}),
    },
  };
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")    { res.status(405).json({ error: "POST only" }); return; }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { to, message, templateName, mapping, apiKey, pluginId, phoneId } = body;

    if (!to)       { res.status(400).json({ error: "Missing 'to'" }); return; }
    if (!apiKey)   { res.status(400).json({ error: "Missing 'apiKey' — WhatsApp page में API key configure करो" }); return; }
    if (!pluginId) { res.status(400).json({ error: "Missing 'pluginId' — WhatsApp page में Plugin ID configure करो" }); return; }

    // Normalize phone: strip +, spaces, dashes, parentheses.
    const phone = String(to).replace(/[\s+\-()]/g, "");
    if (!/^\d{10,15}$/.test(phone)) { res.status(400).json({ error: `Invalid phone number: ${phone}` }); return; }

    const BASE = "https://api.chakrahq.com/v1/ext/plugin/whatsapp";
    const headers = {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type":  "application/json",
    };

    // ── MODE 1: Template Message (outbound alerts — no 24h window needed) ──
    if (templateName) {
      const url = `${BASE}/${pluginId}/phoneNumber/${phone}/send-template-message`;
      const payload = { whatsappPhoneNumberId: phoneId || "", templateName };
      if (Array.isArray(mapping)) payload.mapping = mapping;
      if (body.imageUrl)    payload.imageUrl = body.imageUrl;
      if (body.videoUrl)    payload.videoUrl = body.videoUrl;
      if (body.documentUrl) payload.documentUrl = body.documentUrl;
      if (body.language)    payload.language = body.language;

      const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });
      const result = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        res.status(resp.status).json({
          error: result?._errors?.[0] || result?.error?.message || `Chakra HQ returned ${resp.status}`,
          details: result,
        });
        return;
      }
      res.status(200).json({
        success: true,
        messageId: result?._data?.externalId || result?._data?.id || null,
        deliveryStatus: result?._data?.deliveryStatus || null,
      });
      return;
    }

    // ── MODE 1b: approved template with body values ──
    // { to, template: { name, language, params: [...] }, ... }
    // This is what ERP alerts use: a template is the only message WhatsApp
    // delivers to someone who has not written in the last 24 hours.
    if (body.template && body.template.name) {
      if (!phoneId) { res.status(400).json({ error: "Missing 'phoneId' — WhatsApp Settings में Phone number ID डालो" }); return; }
      const url = `${BASE}/${pluginId}/api/v21.0/${phoneId}/messages`;
      const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(buildTemplatePayload(phone, body.template)) });
      const result = await resp.json().catch(() => ({}));
      if (!resp.ok || result?.error) {
        res.status(resp.ok ? 400 : resp.status).json({
          error: result?.error?.error_user_msg || result?.error?.message || result?._errors?.[0] || `Chakra HQ returned ${resp.status}`,
          details: result,
        });
        return;
      }
      res.status(200).json({ success: true, messageId: result?.messages?.[0]?.id || result?._data?.id || null });
      return;
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
        res.status(resp.status).json({
          error: result?._errors?.[0] || result?.error?.message || `Chakra HQ returned ${resp.status}`,
          details: result,
        });
        return;
      }
      res.status(200).json({
        success: true,
        messageId: result?._data?.whatsappMessageId || result?._data?.id || null,
      });
      return;
    }

    res.status(400).json({ error: "Provide either 'message' (session) or 'templateName' (template)" });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
