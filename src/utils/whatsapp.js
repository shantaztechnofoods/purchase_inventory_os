// WhatsApp click-to-chat helpers.
// Opens the EXACT vendor chat (via wa.me) with a prefilled message so the operator
// only has to press Send. Validates + normalizes Indian mobile numbers.

const COMPANY_NAME = "Shantaz Technofoods";

// Normalize a raw phone string to wa.me form: 91 + 10-digit mobile (12 digits, no +).
// Accepts: "9876543210", "098765 43210", "+91 98765-43210", "0091 9876543210", etc.
// Returns { ok:true, number:"919876543210" } or { ok:false, error:"missing"|"invalid" }.
export function normalizeIndianMobile(raw) {
  if (raw == null || String(raw).trim() === "") return { ok: false, error: "missing" };

  let d = String(raw).replace(/\D/g, "");   // digits only
  if (d.startsWith("00")) d = d.slice(2);   // drop 00 international prefix

  if (d.length === 10) {
    d = "91" + d;                            // bare 10-digit mobile
  } else if (d.length === 11 && d.startsWith("0")) {
    d = "91" + d.slice(1);                   // leading-0 trunk prefix
  } else if (d.length === 12 && d.startsWith("91")) {
    /* already 91 + 10 digits */
  } else if (d.length === 13 && d.startsWith("910")) {
    d = "91" + d.slice(3);                   // 91 + 0 + 10 digits
  } else {
    return { ok: false, error: "invalid" };
  }

  const local = d.slice(2);                  // last 10 digits
  if (!/^[6-9]\d{9}$/.test(local)) return { ok: false, error: "invalid" };  // Indian mobiles start 6-9
  return { ok: true, number: d };
}

// Build the standard PO confirmation message (exact business template).
export function buildPOWhatsAppMessage(po = {}, vendorName = "") {
  const amount    = Number(po.amount || 0).toLocaleString("en-IN");
  const itemCount = Array.isArray(po.lineItems) ? po.lineItems.length : (po.itemCount || 0);
  return [
    `Purchase Order: ${po.id || ""}`,
    `Vendor: ${vendorName || po.vendor || ""}`,
    `Amount: ₹${amount}`,
    `Items: ${itemCount}`,
    ``,
    `Please confirm this order and provide ETA.`,
    ``,
    `Regards,`,
    COMPANY_NAME,
  ].join("\n");
}

// Low-level: open wa.me for a normalized number with an optional prefilled message.
function openChat(number, message) {
  const url = `https://wa.me/${number}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
  console.info("[WA] opening chat", { number, url });
  window.open(url, "_blank", "noopener,noreferrer");
}

// Open a vendor's chat prefilled with the PO confirmation message.
// Returns { ok:true } or { ok:false, error:"missing"|"invalid" } so the caller can toast.
export function sendPOWhatsApp(po, vendor) {
  const phone = vendor?.phone || po?.vendorPhone || "";
  const norm  = normalizeIndianMobile(phone);
  console.info("[WA] sendPOWhatsApp", { po: po?.id, vendor: vendor?.name || po?.vendor, rawPhone: phone, normalized: norm });
  if (!norm.ok) return norm;
  openChat(norm.number, buildPOWhatsAppMessage(po, vendor?.name));
  return { ok: true };
}

// Open a vendor's chat directly (no PO context). Optional prefilled message.
export function openVendorWhatsApp(vendor, message = "") {
  const norm = normalizeIndianMobile(vendor?.phone);
  console.info("[WA] openVendorWhatsApp", { vendor: vendor?.name, rawPhone: vendor?.phone, normalized: norm });
  if (!norm.ok) return norm;
  openChat(norm.number, message);
  return { ok: true };
}

// Map an error code from the helpers to the exact user-facing toast text.
export function waErrorToast(error) {
  return error === "missing"
    ? "Vendor mobile number not found."
    : "Invalid vendor mobile number.";
}
