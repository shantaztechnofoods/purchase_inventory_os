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

// Finds every attachment in a message, wherever Chakra put it, and flattens it
// to { kind, mediaId, url, mimeType, caption, filename }.
//
// The shape is not documented. A photo can arrive as an attachments[] row, as
// WhatsApp's own { image: { id, mime_type } }, nested under body, or as a
// hosted file URL instead of a media id. Rather than bet on one, the message is
// walked a few levels deep and any node carrying a media id or a file URL is
// taken. Exported so the shapes stay under test.
const MEDIA_KEYS = ["image", "audio", "voice", "video", "document", "sticker"];
const URL_KEYS = ["url", "link", "mediaUrl", "media_url", "fileUrl", "file_url", "publicUrl", "downloadUrl", "s3Url", "src"];

export function normaliseAttachments(m) {
  const found = [];
  const seen = new Set();

  const walk = (node, hint, depth) => {
    if (!node || typeof node !== "object" || depth > 5) return;
    if (Array.isArray(node)) { node.forEach((n) => walk(n, hint, depth + 1)); return; }

    const mimeType = String(node.mimeType || node.mime_type || node.contentType || node.content_type || "").split(";")[0].trim();
    const type     = String(node.type || node.kind || node.mediaType || "").toLowerCase();
    const url      = URL_KEYS.map((k) => node[k]).find((v) => typeof v === "string" && /^https?:\/\//.test(v)) || "";
    const looksMedia = !!(mimeType || url || hint || MEDIA_KEYS.includes(type));
    const mediaId  = node.mediaId || node.media_id || (looksMedia && (mimeType || hint) ? node.id : "") || "";

    if (looksMedia && (mediaId || url)) {
      const key = String(mediaId || url);
      if (!seen.has(key)) {
        seen.add(key);
        const kind = /^image\//.test(mimeType) ? "image"
                   : /^audio\//.test(mimeType) ? "audio"
                   : /^video\//.test(mimeType) ? "video"
                   : MEDIA_KEYS.includes(type) ? type
                   : hint || "file";
        found.push({
          kind: kind === "sticker" ? "image" : kind === "voice" ? "audio" : kind,
          mediaId: String(mediaId || ""),
          url,
          mimeType,
          caption:  node.caption || "",
          filename: node.filename || node.fileName || node.name || "",
        });
      }
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === "object") walk(v, MEDIA_KEYS.includes(k) ? k : (k === "attachments" ? "" : hint), depth + 1);
    }
  };

  if (m && typeof m === "object") {
    for (const [k, v] of Object.entries(m)) {
      if (v && typeof v === "object") walk(v, MEDIA_KEYS.includes(k) ? k : "", 1);
    }
  }
  return found;
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
