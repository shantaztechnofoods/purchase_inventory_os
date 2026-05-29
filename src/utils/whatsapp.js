// WhatsApp click-to-chat helpers.
// Opens the EXACT vendor chat with a prefilled message so the operator only has to
// press Send. Validates + normalizes Indian mobile numbers.

// Build marker — printed on every WA action so you can confirm in the PRODUCTION console
// that the latest whatsapp.js is actually live. If you don't see this tag, the deployed
// bundle is stale (redeploy on Vercel without build cache + hard-refresh).
export const WA_BUILD = "wa-2026-05-29d-webfix";

const DEFAULT_COMPANY_NAME = "Shantaz Technofoods";

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
// companyName comes from the active PO company profile; falls back to the default.
export function buildPOWhatsAppMessage(po = {}, vendorName = "", companyName = "") {
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
    companyName || DEFAULT_COMPANY_NAME,
  ].join("\n");
}

// Low-level: open the vendor chat with the message prefilled.
// Desktop browsers must use web.whatsapp.com/send?phone=&text= — the wa.me link
// redirects through a "Continue to Chat" page on desktop and drops the text, leaving
// the message box empty. Mobile keeps wa.me so it deep-links into the installed app.
function openChat(number, message) {
  const text = message ? encodeURIComponent(message) : "";
  const isMobile = typeof navigator !== "undefined" &&
    /Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent || "");
  const url = isMobile
    ? `https://wa.me/${number}${text ? `?text=${text}` : ""}`
    : `https://web.whatsapp.com/send?phone=${number}${text ? `&text=${text}` : ""}&type=phone_number&app_absent=0`;
  // console.warn so these survive production console-stripping (build keeps warn/error).
  console.warn(`[WA ${WA_BUILD}] phone   :`, number);
  console.warn(`[WA ${WA_BUILD}] platform:`, isMobile ? "mobile (wa.me)" : "desktop (web.whatsapp.com)");
  console.warn(`[WA ${WA_BUILD}] text len:`, text.length);
  console.warn(`[WA ${WA_BUILD}] URL     :`, url);
  if (!text) console.error(`[WA ${WA_BUILD}] WARNING: message is empty — text= will be blank!`);
  window.open(url, "_blank", "noopener,noreferrer");
}

// Open a vendor's chat prefilled with the PO confirmation message.
// Returns { ok:true } or { ok:false, error:"missing"|"invalid" } so the caller can toast.
export function sendPOWhatsApp(po, vendor, companyName = "") {
  const phone   = vendor?.phone || po?.vendorPhone || "";
  const norm    = normalizeIndianMobile(phone);
  const message = buildPOWhatsAppMessage(po, vendor?.name, companyName);
  console.warn(`[WA ${WA_BUILD}] ── PO WhatsApp ──`, {
    poNumber:        po?.id,
    vendorName:      vendor?.name || po?.vendor,
    rawPhone:        phone,
    normalizedPhone: norm.ok ? norm.number : `(invalid: ${norm.error})`,
    amount:          po?.amount,
    itemCount:       Array.isArray(po?.lineItems) ? po.lineItems.length : 0,
    company:         companyName,
    message,
  });
  if (!norm.ok) return norm;
  openChat(norm.number, message);
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
