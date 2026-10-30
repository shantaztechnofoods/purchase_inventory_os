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
    const { apiKey, mediaId, url: fileUrl } = body;
    if (!apiKey) { res.status(400).json({ error: "Missing 'apiKey'" }); return; }
    if (!mediaId && !fileUrl) { res.status(400).json({ error: "Missing 'mediaId' or 'url'" }); return; }

    // Follows one redirect by hand: the first hop needs the key, the storage
    // URL it points to rejects any Authorization header.
    const get = async (target, withAuth) => {
      let r = await fetch(target, {
        headers: withAuth ? { Authorization: `Bearer ${apiKey}` } : {},
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
      });
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get("location");
        if (!loc) return null;
        r = await fetch(new URL(loc, target).toString(), { signal: AbortSignal.timeout(20000) });
      }
      return r;
    };

    // Media id first (WhatsApp's own media), then the hosted file URL. Either
    // one is enough; trying both is what makes the inbox survive whichever
    // shape Chakra used for this message.
    let resp = null;
    const tried = [];
    if (mediaId) {
      resp = await get(`https://api.chakrahq.com/v2/whatsapp/${WA_API_VERSION}/media/${encodeURIComponent(mediaId)}/show`, true);
      tried.push(`media:${resp?.status ?? "no-redirect"}`);
    }
    if ((!resp || !resp.ok) && fileUrl) {
      const isChakra = /(^|\.)chakrahq\.com$/i.test(new URL(fileUrl).hostname);
      resp = await get(fileUrl, isChakra);
      tried.push(`url:${resp?.status ?? "no-redirect"}`);
    }
    if (!resp || !resp.ok) {
      res.status(502).json({ error: `Could not download the file (${tried.join(", ")})` });
      return;
    }

    const mimeType = (resp.headers.get("content-type") || "application/octet-stream").split(";")[0];
    const buf = Buffer.from(await resp.arrayBuffer());
    if (!buf.length) { res.status(502).json({ error: "The file came back empty" }); return; }
    if (buf.length > MAX_RAW_BYTES) {
      res.status(413).json({ error: "File is too large to show here — open it in WhatsApp", bytes: buf.length });
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
