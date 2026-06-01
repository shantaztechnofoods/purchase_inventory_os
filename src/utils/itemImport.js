// Item import helpers. Pure functions — no React, no Supabase, no DOM — so the
// logic can be unit-tested from Node against the operator's real accounting-sheet
// column headers ("Name", "HSN Code", "Purc. Price", "Sale Price").

// ── Field aliases ────────────────────────────────────────────────────────────
// Header matching strips parenthetical suffixes ("Purc. Price (₹)" → "purc. price"
// → "purc price" after dot/whitespace collapse) and falls through alias lists.
//
// `code` is split from `hsn` deliberately so we can implement the spec's priority:
//   "Item Code" wins; if blank, fall back to HSN.
export const ITEM_FIELDS = [
  { key: "name",     aliases: ["item name","name","product name","material name","product","item","description"] },
  { key: "unit",     aliases: ["unit","uom","unit of measure","unit of measurement"] },
  { key: "category", aliases: ["category","group","machine","department","section"] },
  { key: "location", aliases: ["location","storage location","rack","shelf","bin","store","storage"] },
  { key: "stock",    aliases: ["opening stock","stock","quantity","qty","on hand","current stock","balance"] },
  { key: "min",      aliases: ["min stock","minimum stock","minimum stock alert level","reorder level","minimum","min","minimum level","alert level"] },
  { key: "lastPurchaseRate", aliases: ["purc. price","purchase price","purc price","last rate","last purchase rate","cost","rate","unit cost","unit price","purchase rate","buy price","cost price"] },
  { key: "salePrice", aliases: ["sale price","selling price","sell price","mrp","msrp","srp","retail price"] },
];

const CODE_PRIMARY_ALIASES = ["item code","code","sku","part number","part no","part no.","material code"];
const CODE_HSN_ALIASES     = ["hsn code","hsn","hsn no","hsn no.","hsn number","hsn/sac","hsn / sac"];

// ── Header normalisation ────────────────────────────────────────────────────
const normHeader = (s) => String(s).trim().toLowerCase().replace(/\s+/g, " ");
const stripParen = (s) => s.replace(/\s*\([^)]*\)\s*/g, "").replace(/\s+/g, " ").trim();
const stripDots  = (s) => s.replace(/\./g, "").replace(/\s+/g, " ").trim();

export function matchAlias(headerName, aliases) {
  const n = normHeader(headerName);
  if (aliases.includes(n)) return true;
  const noParen  = stripParen(n);
  if (noParen && noParen !== n && aliases.includes(noParen)) return true;
  // "Purc. Price" → "purc. price" → strip dot → "purc price" matches "purc price"
  const noDots = stripDots(n);
  if (noDots && noDots !== n && aliases.includes(noDots)) return true;
  const noParenNoDots = stripDots(noParen);
  if (noParenNoDots && noParenNoDots !== n && aliases.includes(noParenNoDots)) return true;
  return false;
}

// ── Cell-value readers ──────────────────────────────────────────────────────
const readCell = (v) => (v == null ? "" : String(v).trim());

function readNumber(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === "") return null;
  // Strip currency symbols + commas + whitespace ("₹1,500.00" → "1500.00")
  const cleaned = s.replace(/[₹$€£,\s]/g, "");
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : null;
}

// ── Code resolution: "Item Code" wins; else HSN ─────────────────────────────
function resolveCode(raw) {
  const primary = Object.keys(raw).find((k) => matchAlias(k, CODE_PRIMARY_ALIASES));
  if (primary !== undefined) {
    const v = readCell(raw[primary]);
    if (v) return v;
  }
  const hsn = Object.keys(raw).find((k) => matchAlias(k, CODE_HSN_ALIASES));
  if (hsn !== undefined) {
    const v = readCell(raw[hsn]);
    if (v) return v;
  }
  return "";
}

// ── Main row mapper ──────────────────────────────────────────────────────────
export function mapRow(raw) {
  const out = {};
  for (const { key, aliases } of ITEM_FIELDS) {
    const found = Object.keys(raw).find((k) => matchAlias(k, aliases));
    out[key] = found !== undefined ? readCell(raw[found]) : "";
  }
  out.code = resolveCode(raw);

  // Numerics — defaults are applied per spec (Opening Stock = 0, Min = 0, Last
  // Purchase Rate = 0). Sale Price stays null when blank (so the App layer can
  // decide whether the schema supports it — see "store if field exists,
  // otherwise ignore safely" in the spec).
  out.stock = readNumber(out.stock) ?? 0;
  out.min   = readNumber(out.min)   ?? 0;
  const lp  = readNumber(out.lastPurchaseRate);
  out.lastPurchaseRate = lp == null ? 0 : lp;
  const sp  = readNumber(out.salePrice);
  out.salePrice = sp;   // null when blank — App can decide to drop

  // String defaults
  if (!out.unit)     out.unit     = "Nos";
  if (!out.category) out.category = "Mechanical";
  // Location: keep blank if not provided (per spec)
  return out;
}

// ── Classify rows: "ready" (new) / "update" (name match) / skip ─────────────
// Matching is by NAME (case-insensitive), exactly like vendor import.
export function parseRows(rawRows, existingItems) {
  // existingItems is the App's grouped state: { Mechanical: [...], Electrical: [...], ... }
  const flat = [];
  if (existingItems && typeof existingItems === "object" && !Array.isArray(existingItems)) {
    for (const [cat, list] of Object.entries(existingItems)) {
      if (Array.isArray(list)) for (const it of list) flat.push({ ...it, category: it.category || cat });
    }
  } else if (Array.isArray(existingItems)) {
    for (const it of existingItems) flat.push(it);
  }
  const existing = new Map(
    flat.map((it) => [String(it.name || "").trim().toLowerCase(), it])
  );
  const out = [];
  for (const r of rawRows || []) {
    const mapped = mapRow(r);
    // Only Item Name is required (per spec). Blank name → skip silently.
    if (!mapped.name) continue;
    const match = existing.get(mapped.name.toLowerCase());
    if (match) {
      out.push({
        ...mapped,
        _status: "update",
        _existingCode:     match.code,
        _existingCategory: match.category,
      });
    } else {
      out.push({ ...mapped, _status: "ready" });
    }
  }
  return out;
}

// ── Code generator for items with no Item Code and no HSN ───────────────────
// Slug-from-name + 4-digit suffix. The App layer uses this when row.code is blank
// and we still need to insert the row (Name is the only mandatory column).
export function generateItemCode(name) {
  const slug = String(name || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const suffix = Math.floor(Math.random() * 9000 + 1000).toString();
  return slug ? `${slug}-${suffix}` : `ITEM-${Date.now().toString(36).toUpperCase()}`;
}
