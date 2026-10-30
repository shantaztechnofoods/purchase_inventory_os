// BOM cost & validation — pure helpers (2026-10-31, brief §12).
//
// A BOM line is { code, qty }. Rates come only from data the ERP already
// holds; nothing here ever guesses a number:
//   1. item.lastPurchaseRate      — set on the Item Master
//   2. item.defaultPurchaseRate   — operator-set fallback (migration 020)
//   3. latest *received* PO line for the code with a rate > 0
// When none of those exist the line is "Missing rate" and the BOM total is
// reported as incomplete — the UI then offers an authorized user a field to
// enter and save the rate (into defaultPurchaseRate), never a made-up value.

export const RATE_SOURCE_LABEL = {
  last_purchase: "Item Master · last purchase",
  default:       "Item Master · default rate",
  received_po:   "Received PO",
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// Most recent received-PO rate per item code, built once from the PO list.
// Only POs with status "received" count; rate must be > 0 to be a real rate.
export function receivedPoRates(pos = []) {
  const out = {};
  const list = (pos || []).filter((p) => p && p.status === "received");
  // Newest first by receivedDate, then date, then id as a last resort.
  const key = (p) => String(p.receivedDate || p.received_date || p.date || "");
  list.sort((a, b) => (key(b) > key(a) ? 1 : key(b) < key(a) ? -1 : 0));
  for (const p of list) {
    const lines = Array.isArray(p.lineItems) ? p.lineItems : Array.isArray(p.line_items) ? p.line_items : [];
    for (const l of lines) {
      const code = l && l.code;
      const rate = num(l && l.rate);
      if (!code || rate <= 0 || out[code]) continue;
      out[code] = { rate, poId: p.id, date: key(p) };
    }
  }
  return out;
}

export function resolveItemRate(inv, poRates = {}) {
  if (inv) {
    const last = num(inv.lastPurchaseRate);
    if (last > 0) return { rate: last, source: "last_purchase" };
    const def = num(inv.defaultPurchaseRate);
    if (def > 0) return { rate: def, source: "default" };
  }
  const code = inv && inv.code;
  const po = code ? poRates[code] : null;
  if (po && po.rate > 0) return { rate: po.rate, source: "received_po", poId: po.poId };
  return { rate: null, source: null };
}

// lines: BOM items; findInv(code) → Item Master record or undefined.
export function bomCostLines(lines = [], findInv = () => undefined, poRates = {}, units = 1) {
  const u = Math.max(1, Math.floor(num(units)) || 1);
  const seen = {};
  const out = [];
  for (const l of lines || []) {
    const code = String((l && l.code) || "").trim();
    const qty = num(l && l.qty);
    const inv = code ? findInv(code) : undefined;
    seen[code] = (seen[code] || 0) + 1;
    const r = inv ? resolveItemRate(inv, poRates) : (code && poRates[code] ? { rate: poRates[code].rate, source: "received_po", poId: poRates[code].poId } : { rate: null, source: null });
    const totalQty = qty * u;
    const amount = r.rate != null ? Math.round(r.rate * totalQty * 100) / 100 : null;
    let status = "ok";
    if (!inv) status = "missing_item";
    else if (qty <= 0) status = "zero_qty";
    else if (r.rate == null) status = "missing_rate";
    out.push({
      code, qty, totalQty, name: inv ? inv.name : code, unit: inv ? (inv.unit || "") : "",
      rate: r.rate, rateSource: r.source, poId: r.poId || null, amount, status, inv: inv || null,
    });
  }
  for (const o of out) if (seen[o.code] > 1) o.duplicate = true;
  return out;
}

export function bomCostSummary(costLines = []) {
  const known = costLines.filter((l) => l.amount != null).reduce((s, l) => s + l.amount, 0);
  const missingRate = costLines.filter((l) => l.status === "missing_rate").length;
  const missingItem = costLines.filter((l) => l.status === "missing_item").length;
  const zeroQty = costLines.filter((l) => l.status === "zero_qty").length;
  const duplicates = [...new Set(costLines.filter((l) => l.duplicate).map((l) => l.code))];
  const missingUnit = costLines.filter((l) => l.inv && !l.unit).length;
  const complete = costLines.length > 0 && missingRate === 0 && missingItem === 0 && zeroQty === 0 && duplicates.length === 0;
  return {
    knownTotal: Math.round(known * 100) / 100,
    lines: costLines.length,
    missingRate, missingItem, zeroQty, duplicates, missingUnit,
    complete,
  };
}

// Problems that must be fixed before a BOM can be saved, plus warnings.
export function validateBomLines(lines = [], findInv = () => undefined) {
  const errors = [];
  const warnings = [];
  const codes = (lines || []).map((l) => String((l && l.code) || "").trim());
  const dup = codes.filter((c, i) => c && codes.indexOf(c) !== i);
  if (dup.length) errors.push(`Duplicate component${dup.length > 1 ? "s" : ""}: ${[...new Set(dup)].join(", ")} — keep one line per item.`);
  for (const l of lines || []) {
    const code = String((l && l.code) || "").trim();
    if (!code) { errors.push("A line has no item code."); continue; }
    const qty = num(l.qty);
    if (!(qty > 0)) errors.push(`${code}: quantity must be more than 0.`);
    if (!findInv(code)) warnings.push(`${code} is not in the Item Master — stock, unit and rate cannot be checked.`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

export function formatINR(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
