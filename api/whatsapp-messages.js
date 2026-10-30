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

// Flattens whatever Chakra calls an attachment into one shape the inbox can
// render: { kind, mediaId, mimeType, caption, filename }. Exported so the
// shapes stay under test instead of being discovered in production.
export function normaliseAttachments(m) {
  const rows = [
    ...(Array.isArray(m?.attachments) ? m.attachments : []),
    ...(Array.isArray(m?.body?.attachments) ? m.body.attachments : []),
  ];

  // WhatsApp's own message JSON has no attachments array at all — the media
  // sits under a key named after its type.
  for (const kind of ["image", "audio", "voice", "video", "document", "sticker"]) {
    const node = m?.[kind] || m?.body?.[kind];
    if (node && typeof node === "object") rows.push({ ...node, type: kind });
  }

  return rows.map((a) => {
    const mimeType = String(a?.mimeType || a?.mime_type || a?.contentType || "").split(";")[0];
    const type     = String(a?.type || a?.kind || a?.mediaType || "").toLowerCase();
    return {
      // The declared type is often missing while the MIME is not, so the MIME
      // decides when it can: a photo must be drawn, a document only listed.
      kind:     /^image\//.test(mimeType) ? "image"
              : /^audio\//.test(mimeType) ? "audio"
              : /^video\//.test(mimeType) ? "video"
              : type || "file",
      mediaId:  a?.mediaId || a?.media_id || a?.id || a?.externalId || "",
      mimeType,
      caption:  a?.caption || "",
      filename: a?.filename || a?.name || "",
    };
  }).filter((a) => a.mediaId || a.filename || a.caption);
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")    { res.status(405).json({ error: "POST only" }); return; }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { apiKey, chatId } = body;
    if (!apiKey) { res.status(400).json({ error: "Missing 'apiKey'" }); return; }
    if (!chatId) { res.status(400).json({ error: "Missing 'chatId'" }); return; }

    const url = `https://api.chakrahq.com/v1/ext/chat/${encodeURIComponent(chatId)}/message`;
    const headers = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" };
    const call = (payload) => fetch(url, { method: "POST", headers, body: JSON.stringify(payload) });

    // Same deal as the chat list: orderField is a plain field name, and the
    // body schema is documented only by example — so a rejected shape falls
    // back to the empty body the docs' own cURL sample sends.
    let resp = await call({ orderField: "createdAt", limit: 200, page: 1 });
    if (resp.status === 400) resp = await call({});

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
        // Chakra sends these in CAPITALS ("OUTBOUND", "READ"). Lower-casing
        // here keeps the comparison in one place — the UI was checking for
        // "outbound" and so drew every one of our own messages as incoming.
        direction:     String(m?.direction || "").toLowerCase(),
        status:        String(m?.deliveryStatus || "").toLowerCase(),
        ts:            m?.timestamp || m?.createdAt || 0,
        hasAttachment: Array.isArray(m?.attachments) && m.attachments.length > 0,
        // A photo of a fault is often the whole message, so the thread needs
        // more than a "📎" — it needs the media id to fetch the image with.
        // Which field carries it is not documented, so every shape seen in the
        // webhook's real payloads is checked and the first hit wins.
        attachments:   normaliseAttachments(m),
      }))
      .sort((a, b) => (a.ts || 0) - (b.ts || 0));

    // Attachment shapes are documented only by example. When a photo will not
    // render, this returns the untouched upstream rows so the real field names
    // can be read off instead of guessed at.
    if (body.debug) {
      res.status(200).json({
        success: true, debug: true,
        rawPreview: JSON.stringify(result?._data || []).slice(0, 4000),
      });
      return;
    }

    res.status(200).json({ success: true, messages });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
