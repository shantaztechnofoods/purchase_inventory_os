// Vercel serverless function — list WhatsApp conversations from Chakra HQ.
//
// Chakra HQ already stores every conversation on the business number, so the
// ERP reads them rather than keeping its own copy. That is why this feature
// needs no webhook, no messages table and no migration: there is one source of
// truth and it is Chakra's, so the ERP inbox can never drift out of sync with
// what the WhatsApp number actually received.
//
// Upstream: POST https://api.chakrahq.com/v1/ext/chat
//   -> { _data: [ { id, primaryContact, primaryContactHandle, latestMessage,
//                   latestMessageTs, latestMessageDirection, status, ... } ] }
//
// Body in: { apiKey, limit?, page?, orderField? }
// Body out: { success, chats: [ { id, name, phone, lastText, lastTs,
//                                 lastDirection, status } ] }
//
// The Chakra API key arrives in the request body from the ERP's WhatsApp
// settings and is used server-side only — it is never committed here and never
// becomes a third-party request from the browser.

export default async function handler(req, res) {
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")    { res.status(405).json({ error: "POST only" }); return; }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const { apiKey, limit, page, orderField, debug } = body;
    if (!apiKey) { res.status(400).json({ error: "Missing 'apiKey' — add the API key in WhatsApp Settings" }); return; }

    const headers = { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" };
    const call = (payload) => fetch("https://api.chakrahq.com/v1/ext/chat", {
      method: "POST", headers, body: JSON.stringify(payload),
    });

    // orderField takes a PLAIN field name. A "-latestMessageTs" (descending)
    // value is rejected with a 400, so newest-first is done by sorting the
    // flattened result below instead of asking the API for it.
    const firstBody = { orderField: orderField || "createdAt", limit: Number(limit) || 50, page: Number(page) || 1 };
    let resp = await call(firstBody);
    let usedFallback = false;
    const firstStatus = resp.status;
    // The body schema is only documented by example, so a rejected shape falls
    // back to the minimal body the docs' own cURL sample uses.
    if (resp.status === 400) { resp = await call({}); usedFallback = true; }

    // Returns exactly what Chakra replied, so an empty inbox can be told apart
    // from a request we built wrong or a key that cannot see chats.
    if (debug) {
      const rawText = await resp.text().catch(() => "");
      res.status(200).json({
        success: true, debug: true,
        firstBodySent: firstBody, firstStatus, usedFallback,
        finalStatus: resp.status,
        rawPreview: rawText.slice(0, 1200),
      });
      return;
    }

    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      res.status(resp.status).json({
        error: result?._errors?.[0] || result?.error?.message || `Chakra HQ returned ${resp.status}`,
        details: result,
      });
      return;
    }

    // Flatten to only what the inbox renders. Chakra's chat object is large and
    // most of it (procedure, campaign, chatbot state) is irrelevant here.
    const chats = (Array.isArray(result?._data) ? result._data : []).map((c) => ({
      id:            c?.id || "",
      name:          c?.primaryContact?.name
                     || [c?.primaryContact?.firstName, c?.primaryContact?.lastName].filter(Boolean).join(" ")
                     || c?.primaryContactHandle?.value
                     || c?.providerHandle
                     || "Unknown",
      phone:         c?.primaryContactHandle?.value || c?.providerHandle || "",
      lastText:      c?.latestMessage?.text || c?.latestMessage?.body?.text?.body || "",
      lastTs:        c?.latestMessageTs || c?.latestMessage?.timestamp || c?.updatedAt || 0,
      // Capitals from Chakra, lower-cased so the UI's "outbound" check works.
      lastDirection: String(c?.latestMessageDirection || c?.latestMessage?.direction || "").toLowerCase(),
      status:        c?.status || "",
    }));

    // Newest conversation first — the API orders by a plain field only, so the
    // inbox ordering is applied here.
    chats.sort((a, b) => (Number(b.lastTs) || 0) - (Number(a.lastTs) || 0));

    res.status(200).json({ success: true, chats });
  } catch (err) {
    res.status(500).json({ error: err?.message || "Internal server error" });
  }
}
