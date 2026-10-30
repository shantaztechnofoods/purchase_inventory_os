// Vercel serverless function — list the messages of one WhatsApp conversation.
//
// Upstream: POST https://api.chakrahq.com/v1/ext/chat/{chatId}/message
//   -> { _data: [ { id, body: { text: { body } }, text, direction,
//                   deliveryStatus, timestamp, createdAt, attachments } ] }
//
// Body in:  { apiKey, chatId }
// Body out: { success, messages: [ { id, text, direction, status, ts,
//                                    hasAttachment } ] }
//
// Messages come back oldest-first so the thread renders top-to-bottom like a
// normal chat; Chakra's ordering is not guaranteed, so we sort here rather
// than trusting the upstream order.

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")    { res.status(405).json({ error: "POST only" }); return; }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { apiKey, chatId } = body;
    if (!apiKey) { res.status(400).json({ error: "Missing 'apiKey'" }); return; }
    if (!chatId) { res.status(400).json({ error: "Missing 'chatId'" }); return; }

    const resp = await fetch(`https://api.chakrahq.com/v1/ext/chat/${encodeURIComponent(chatId)}/message`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 200, page: 1 }),
    });

    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      res.status(resp.status).json({
        error: result?._errors?.[0] || result?.error?.message || `Chakra HQ returned ${resp.status}`,
        details: result,
      });
      return;
    }

    const messages = (Array.isArray(result?._data) ? result._data : [])
      .map((m) => ({
        id:            m?.id || "",
        text:          m?.text || m?.body?.text?.body || "",
        direction:     m?.direction || "",
        status:        m?.deliveryStatus || "",
        ts:            m?.timestamp || m?.createdAt || 0,
        hasAttachment: Array.isArray(m?.attachments) && m.attachments.length > 0,
      }))
      .sort((a, b) => (a.ts || 0) - (b.ts || 0));

    res.status(200).json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
