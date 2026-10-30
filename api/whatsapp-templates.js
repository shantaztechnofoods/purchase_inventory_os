// Vercel serverless function — WhatsApp message templates via Chakra HQ.
//
// Templates are what lets the ERP START a conversation (an alert to someone
// who has not messaged us in the last 24 hours). Without an approved one,
// WhatsApp rejects every outbound-first message — which is exactly what the
// "Rejected By Whatsapp" delivery status meant.
//
// Both operations are pass-throughs to Meta's Cloud API via Chakra:
//   list   -> GET  /v1/ext/plugin/whatsapp/api/{ver}/{wabaId}/message_templates
//   create -> POST /v1/ext/plugin/whatsapp/api/{ver}/{wabaId}/message_templates
//
// Body in: { action: "list" | "create", apiKey, wabaId, apiVersion?, template? }
// Body out: { success, templates: [...] }  |  { success, id, status, category }
//
// The API key arrives from the ERP's WhatsApp settings and stays server-side.

const DEFAULT_VERSION = "v21.0";

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")    { res.status(405).json({ error: "POST only" }); return; }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { action, apiKey, wabaId, apiVersion, template } = body;

    if (!apiKey) { res.status(400).json({ error: "Missing 'apiKey' — WhatsApp Settings में API key डालो" }); return; }
    if (!wabaId) { res.status(400).json({ error: "Missing 'wabaId' — WhatsApp Settings में WABA ID डालो" }); return; }

    const ver  = apiVersion || DEFAULT_VERSION;
    const base = `https://api.chakrahq.com/v1/ext/plugin/whatsapp/api/${encodeURIComponent(ver)}/${encodeURIComponent(wabaId)}/message_templates`;
    const headers = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" };

    // ── LIST ──────────────────────────────────────────────────────────────
    if (action === "list" || !action) {
      const resp = await fetch(`${base}?limit=50`, { method: "GET", headers });
      const result = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        res.status(resp.status).json({
          error: result?.error?.message || result?._errors?.[0] || `Chakra HQ returned ${resp.status}`,
          details: result,
        });
        return;
      }
      const templates = (Array.isArray(result?.data) ? result.data : []).map((t) => ({
        id:       t?.id || "",
        name:     t?.name || "",
        status:   t?.status || "",          // APPROVED | PENDING | REJECTED
        category: t?.category || "",
        language: t?.language || "",
        // Flatten the BODY component's text — that is what the operator reads.
        text:     (Array.isArray(t?.components) ? t.components : [])
                    .find((c) => (c?.type || "").toUpperCase() === "BODY")?.text || "",
      }));
      res.status(200).json({ success: true, templates });
      return;
    }

    // ── CREATE ────────────────────────────────────────────────────────────
    if (action === "create") {
      if (!template || !template.name || !template.components) {
        res.status(400).json({ error: "Missing template {name, category, language, components}" });
        return;
      }
      const resp = await fetch(base, { method: "POST", headers, body: JSON.stringify(template) });
      const result = await resp.json().catch(() => ({}));
      // Meta sometimes answers 200 with an error object in the payload, so the
      // error check cannot rely on the HTTP status alone.
      if (!resp.ok || result?.error) {
        res.status(resp.ok ? 400 : resp.status).json({
          error: result?.error?.error_user_msg || result?.error?.message || result?.message || `Chakra HQ returned ${resp.status}`,
          details: result,
        });
        return;
      }
      res.status(200).json({
        success: true,
        id:       result?.id || "",
        status:   result?.status || "PENDING",
        category: result?.category || template.category || "",
      });
      return;
    }

    res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
