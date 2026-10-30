// Vercel serverless function — fetch one WhatsApp attachment for the ERP inbox.
//
// WhatsApp media is NOT a public URL. Every download needs the Chakra API key,
// which must never reach the browser — so an <img src> cannot point at Chakra
// directly. This endpoint downloads the file server-side and hands back a
// data: URL the browser can render, which keeps the key on the server and
// still lets a photo of a leaking pump appear inside the thread.
//
// Body in:  { apiKey, mediaId }
// Body out: { success, dataUrl, mimeType, bytes }
//
// Same download dance as the auto-reply webhook: Chakra answers with a 302 to a
// signed storage URL, and that second request must carry NO auth header or the
// storage layer rejects it.

const WA_API_VERSION = "v21.0";

// A data: URL is base64, which is ~33% larger than the file. Vercel caps a
// serverless response at about 4.5MB, so the raw file has to stay under this or
// the whole response is dropped — a limit worth reporting rather than hitting.
const MAX_RAW_BYTES = 3 * 1024 * 1024;

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")    { res.status(405).json({ error: "POST only" }); return; }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { apiKey, mediaId } = body;
    if (!apiKey)  { res.status(400).json({ error: "Missing 'apiKey'" });  return; }
    if (!mediaId) { res.status(400).json({ error: "Missing 'mediaId'" }); return; }

    const url = `https://api.chakrahq.com/v2/whatsapp/${WA_API_VERSION}/media/${encodeURIComponent(mediaId)}/show`;
    let resp = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      redirect: "manual",
      signal: AbortSignal.timeout(20000),
    });

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      if (!location) { res.status(502).json({ error: "Chakra ne redirect diya par URL nahi" }); return; }
      resp = await fetch(location, { signal: AbortSignal.timeout(20000) }); // no auth header
    }
    if (!resp.ok) {
      res.status(resp.status).json({ error: `Media download failed — ${resp.status}` });
      return;
    }

    const mimeType = (resp.headers.get("content-type") || "application/octet-stream").split(";")[0];
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.length) { res.status(502).json({ error: "Khaali file aayi" }); return; }
    if (buf.length > MAX_RAW_BYTES) {
      res.status(413).json({ error: "File bahut badi hai — WhatsApp par hi kholo", bytes: buf.length });
      return;
    }

    res.status(200).json({
      success: true,
      mimeType,
      bytes: buf.length,
      dataUrl: `data:${mimeType};base64,${buf.toString("base64")}`,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
