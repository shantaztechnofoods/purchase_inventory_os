// Vendor import helpers. Pure functions — no React, no Supabase, no DOM — so the
// logic can be unit-tested from Node against the operator's real accounting-sheet
// column headers ("Name", "Mobile No.", "E-Mail", "Address Line1..4", "GST No.",
// "Credit Days (Purc.)").

// ── Field aliases ────────────────────────────────────────────────────────────
// Header matching strips parenthetical suffixes ("Credit Days (Purc.)" → "credit
// days") and collapses whitespace, so an alias like "credit days" catches the
// (Purc.) form, an alias like "mobile no." catches "Mobile No.", and so on.
export const FIELD_MAP = [
  { key: "name",          aliases: ["vendor name","company name","name","vendor","supplier name","supplier"] },
  { key: "contactPerson", aliases: ["contact person","contact","person","contact name","representative"] },
  { key: "phone",         aliases: ["mobile","phone","mobile no","mobile no.","mobile number","phone no","phone no.","phone number","contact number","whatsapp","cell","cell phone"] },
  { key: "email",         aliases: ["email","email address","mail","e-mail","email id","email-id"] },
  { key: "gst",           aliases: ["gst","gst no","gst no.","gst number","gstin","gst#","gst id","gstin no","gstin number"] },
  { key: "location",      aliases: ["location","city","state","city/state","city, state","place"] },
  { key: "category",      aliases: ["category","category / specialty","specialty","type","vendor type","supplier type","item type"] },
  { key: "paymentTerms",  aliases: ["credit days","credit period","payment terms","payment days","credit","credit term","credit terms","payment term","net days"] },
];

const PLAIN_ADDRESS_KEYS = ["address","full address","billing address","street address","full_address"];
// Matches "Address Line 1", "Address Line1", "AddressLine1", "Address 1", etc.
const ADDRESS_LINE_RE = /^address(?:\s*line)?\s*[1-9]\d*$/;

// ── Header normalisation ────────────────────────────────────────────────────
const normHeader = (s) => String(s).trim().toLowerCase().replace(/\s+/g, " ");
const stripParen = (s) => s.replace(/\s*\([^)]*\)\s*/g, "").replace(/\s+/g, " ").trim();

export function matchAlias(headerName, aliases) {
  const n = normHeader(headerName);
  if (aliases.includes(n)) return true;
  const stripped = stripParen(n);
  if (stripped && stripped !== n && aliases.includes(stripped)) return true;
  return false;
}

// ── Cell-value reader (handles 0, null, undefined, dates, numbers) ──────────
const readCell = (v) => (v == null ? "" : String(v).trim());

// ── Address handling: merge ALL Address(/Line N) columns in sheet order ─────
// Never drop a line. Skip blank segments. Dedupe identical segments. Join with
// ", ". Also extract a best-effort city for the Location field.
export function extractAddressInfo(raw) {
  const lines = [];
  for (const k of Object.keys(raw)) {
    const n = normHeader(k);
    const stripped = stripParen(n);
    const isPlain = PLAIN_ADDRESS_KEYS.includes(n) || PLAIN_ADDRESS_KEYS.includes(stripped);
    const isLine  = ADDRESS_LINE_RE.test(n) || ADDRESS_LINE_RE.test(stripped);
    if (!isPlain && !isLine) continue;
    const v = readCell(raw[k]);
    if (v) lines.push(v);
  }
  // Dedupe identical lines (a sheet with both "Address" and "Address Line 1" set
  // to the same text shouldn't produce "X, X").
  const uniq = [...new Set(lines)];

  // Merge into one clean address. Collapse stray duplicate commas/spaces.
  let address = uniq.join(", ");
  address = address
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

  // Location: first non-pincode segment of the LAST non-empty line.
  // Examples:
  //   "Vapi, Valsad, Gujarat, 396191"  → "Vapi"
  //   "Rajkot, Gujarat"                 → "Rajkot"
  //   only Line1="SHOP NO.14, GROUND FLOOR" → "SHOP NO.14" (best effort)
  let location = "";
  for (let i = uniq.length - 1; i >= 0; i--) {
    const segs = uniq[i].split(",").map((s) => s.trim()).filter(Boolean);
    for (const seg of segs) {
      if (/^\d{4,7}$/.test(seg)) continue;   // skip pincode-like
      location = seg;
      break;
    }
    if (location) break;
  }

  return { address, location };
}

// ── Credit Days → Payment Terms normalisation ────────────────────────────────
// 45      → "45 days"
// "45"    → "45 days"
// 0       → "0 days"   (intentional: explicit zero is meaningful)
// "45 days" → "45 days"
// "" / null / undefined → "30 days" (default — vendor looks like a manual entry)
export function normalizePaymentTerms(value) {
  if (value == null) return "30 days";
  const v = String(value).trim();
  if (v === "") return "30 days";
  if (/^\d+$/.test(v)) return `${v} days`;
  return v;
}

// ── Main row mapper ──────────────────────────────────────────────────────────
export function mapRow(raw) {
  const out = {};
  for (const { key, aliases } of FIELD_MAP) {
    const found = Object.keys(raw).find((k) => matchAlias(k, aliases));
    out[key] = found !== undefined ? readCell(raw[found]) : "";
  }
  const { address, location } = extractAddressInfo(raw);
  out.address = address;
  // Only use the extracted location if the sheet didn't have an explicit Location/City column.
  if (!out.location) out.location = location;
  out.paymentTerms = normalizePaymentTerms(out.paymentTerms);
  return out;
}

// ── Classify rows: "ready" (new vendor) / "update" (existing by name) / skip ─
export function parseRows(rawRows, existingVendors) {
  const existing = new Map(
    (existingVendors || []).map((v) => [String(v.name || "").trim().toLowerCase(), v])
  );
  const out = [];
  for (const r of rawRows || []) {
    const mapped = mapRow(r);
    // Only Vendor Name is required. If Name is blank, skip silently.
    if (!mapped.name) continue;
    const match = existing.get(mapped.name.toLowerCase());
    if (match) {
      out.push({ ...mapped, _status: "update", _existingId: match.id });
    } else {
      out.push({ ...mapped, _status: "ready" });
    }
  }
  return out;
}
