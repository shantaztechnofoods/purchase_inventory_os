// Tests for the WhatsApp auto-reply webhook's payload handling.
//
// The riskiest part of this endpoint is deciding WHAT to answer. Two failures
// would be serious in production and neither is visible from reading the code:
//
//   1. Answering our own outbound message. Chakra echoes every message we send
//      back to the webhook as a *_echo event. Treating one as inbound makes the
//      bot reply to itself, which replies again — an endless loop of real
//      WhatsApp messages to a real customer.
//   2. Silently ignoring a real message because Chakra was configured to send
//      the other payload format.
//
// These tests pin both, plus media extraction and HMAC verification.

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { parseInbound, signatureValid } from "../api/whatsapp-webhook.js";

// ── Chakra Events format ──────────────────────────────────────────────────

test("chakra events: plain inbound text message is accepted", () => {
  const out = parseInbound({
    event: "message",
    payload: {
      wabaId: "1118755894225668",
      messageId: "wamid.ABC",
      message: { from: "919327443134", type: "text", text: { body: "machine band ho gayi" } },
    },
  });
  assert.equal(out.skip, undefined);
  assert.equal(out.from, "919327443134");
  assert.equal(out.text, "machine band ho gayi");
  assert.equal(out.id, "wamid.ABC");
  assert.deepEqual(out.media, []);
});

test("chakra events: our own echoed messages are never answered", () => {
  // This is the loop guard. Both echo events must be refused.
  for (const event of ["message_echo", "smb_message_echo"]) {
    const out = parseInbound({
      event,
      payload: { message: { from: "919327443134", type: "text", text: { body: "ERP ka bheja hua reply" } } },
    });
    assert.ok(out.skip, `${event} must be skipped, got ${JSON.stringify(out)}`);
    assert.match(out.skip, /event=/);
  }
});

test("chakra events: delivery status events are not answered", () => {
  const out = parseInbound({ event: "status", payload: { status: "delivered" } });
  assert.ok(out.skip);
});

test("chakra events: message with no sender is skipped", () => {
  const out = parseInbound({ event: "message", payload: { message: { type: "text", text: { body: "hi" } } } });
  assert.equal(out.skip, "no sender");
});

// ── Meta pass-through format ──────────────────────────────────────────────

test("meta pass-through: inbound text message is accepted", () => {
  const out = parseInbound({
    entry: [{
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          messages: [{ from: "919876543210", id: "wamid.XYZ", type: "text", text: { body: "pump leak ho raha hai" } }],
        },
      }],
    }],
  });
  assert.equal(out.skip, undefined);
  assert.equal(out.from, "919876543210");
  assert.equal(out.text, "pump leak ho raha hai");
  assert.equal(out.id, "wamid.XYZ");
});

test("meta pass-through: delivery receipts are not answered", () => {
  // A statuses-only change carries no message; answering it would mean replying
  // to our own delivered/read receipt.
  const out = parseInbound({
    entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "wamid.XYZ", status: "read" }] } }] }],
  });
  assert.ok(out.skip);
});

test("meta pass-through: an empty payload is skipped rather than throwing", () => {
  assert.ok(parseInbound({}).skip);
  assert.ok(parseInbound({ entry: [] }).skip);
  assert.ok(parseInbound({ entry: [{ changes: [] }] }).skip);
  assert.ok(parseInbound(null).skip);
});

// ── Media ─────────────────────────────────────────────────────────────────

test("image message carries its media id, mime type and caption", () => {
  const out = parseInbound({
    event: "message",
    payload: {
      message: {
        from: "919327443134",
        type: "image",
        image: { id: "media-123", mime_type: "image/jpeg", caption: "ye dekho" },
      },
    },
  });
  assert.equal(out.skip, undefined);
  assert.equal(out.text, "ye dekho");          // caption becomes the text
  assert.equal(out.media.length, 1);
  assert.deepEqual(out.media[0], { kind: "image", mediaId: "media-123", mimeType: "image/jpeg" });
});

test("voice note is accepted even though it carries no text", () => {
  const out = parseInbound({
    event: "message",
    payload: { message: { from: "919327443134", type: "audio", audio: { id: "media-999", mime_type: "audio/ogg" } } },
  });
  assert.equal(out.skip, undefined);
  assert.equal(out.text, "");
  assert.equal(out.media[0].kind, "audio");
  assert.equal(out.media[0].mediaId, "media-999");
});

test("a type we cannot read is skipped instead of being answered blindly", () => {
  const out = parseInbound({
    event: "message",
    payload: { message: { from: "919327443134", type: "location", location: { latitude: 1, longitude: 2 } } },
  });
  assert.ok(out.skip);
  assert.match(out.skip, /unsupported/);
});

// ── HMAC verification ─────────────────────────────────────────────────────

test("signature check passes for a correctly signed body", () => {
  const secret = "s3cr3t";
  const raw = Buffer.from(JSON.stringify({ event: "message" }));
  const sig = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(signatureValid(raw, sig, secret), true);
  assert.equal(signatureValid(raw, `sha256=${sig}`, secret), true);  // prefix tolerated
});

test("signature check rejects a wrong or missing signature", () => {
  const secret = "s3cr3t";
  const raw = Buffer.from(JSON.stringify({ event: "message" }));
  assert.equal(signatureValid(raw, "deadbeef", secret), false);
  assert.equal(signatureValid(raw, "", secret), false);
  assert.equal(signatureValid(raw, undefined, secret), false);
});

test("signature check is a no-op until a secret is configured", () => {
  // Without a secret in the environment the endpoint must still accept calls,
  // otherwise enabling the webhook before setting the secret breaks everything.
  const raw = Buffer.from("{}");
  assert.equal(signatureValid(raw, undefined, ""), true);
});

// ── Loop safety, stated as one explicit case ──────────────────────────────

test("a reply we just sent cannot come back in as something to answer", () => {
  const ourReply = { from: "919327443134", type: "text", text: { body: "Theek hai, dekh lete hain." } };
  assert.ok(parseInbound({ event: "message_echo", payload: { message: ourReply } }).skip);
  assert.ok(parseInbound({ event: "smb_message_echo", payload: { message: ourReply } }).skip);
  assert.ok(parseInbound({ event: "status", payload: { message: ourReply } }).skip);
});

// ── Attachment normalisation (api/whatsapp-messages.js) ───────────────────
// An inbound photo is often the entire message — a leaking pump, a torn seal.
// Chakra's attachment shape is documented only by example, so each shape that
// has actually been seen is pinned here instead of being rediscovered the next
// time a photo renders as "📎".
const { normaliseAttachments } = await import("../api/whatsapp-messages.js");

test("normaliseAttachments: Chakra attachments array with mediaId", () => {
  const out = normaliseAttachments({
    attachments: [{ id: "MEDIA123", mimeType: "image/jpeg", caption: "pump leak" }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "image");
  assert.equal(out[0].mediaId, "MEDIA123");
  assert.equal(out[0].caption, "pump leak");
});

test("normaliseAttachments: WhatsApp-native shape has no array, only a typed key", () => {
  const out = normaliseAttachments({ image: { id: "IMG9", mime_type: "image/png" } });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "image");
  assert.equal(out[0].mediaId, "IMG9");
});

test("normaliseAttachments: a voice note is audio, not a generic file", () => {
  const out = normaliseAttachments({ attachments: [{ media_id: "V1", mime_type: "audio/ogg; codecs=opus" }] });
  assert.equal(out[0].kind, "audio");
  assert.equal(out[0].mimeType, "audio/ogg");
});

test("normaliseAttachments: MIME wins over a wrong declared type", () => {
  // Seen in the wild: type says "document", the file is a JPEG. Drawing it as
  // a download link would hide the photo the sender meant to show.
  const out = normaliseAttachments({ attachments: [{ id: "X", type: "document", mimeType: "image/jpeg" }] });
  assert.equal(out[0].kind, "image");
});

test("normaliseAttachments: a document keeps its filename and is not drawn", () => {
  const out = normaliseAttachments({
    attachments: [{ id: "D1", mimeType: "application/pdf", filename: "invoice.pdf", type: "document" }],
  });
  assert.equal(out[0].kind, "document");
  assert.equal(out[0].filename, "invoice.pdf");
});

test("normaliseAttachments: a plain text message yields nothing", () => {
  assert.deepEqual(normaliseAttachments({ text: "kal aa jao" }), []);
  assert.deepEqual(normaliseAttachments({}), []);
  assert.deepEqual(normaliseAttachments(null), []);
});

test("normaliseAttachments: rows with no id, name or caption are dropped", () => {
  // An empty placeholder would render as an attachment tile with nothing in it.
  assert.deepEqual(normaliseAttachments({ attachments: [{ mimeType: "image/jpeg" }] }), []);
});

// ── Unread / phone matching (src/App.jsx helpers, duplicated as pure logic) ──
// These two decide whether a message shows as new and whose name is on it, so
// they are worth pinning: a phone comparison that misses turns the whole
// number book into dead weight.
test("phone matching ignores country code, spaces and +", () => {
  const key = (p) => { const d = String(p).replace(/[^0-9]/g, ""); return d.length > 10 ? d.slice(-10) : d; };
  assert.equal(key("+91 93274 43134"), key("919327443134"));
  assert.equal(key("09327443134"), key("9327443134"));
  assert.notEqual(key("919327443134"), key("919327443135"));
});
