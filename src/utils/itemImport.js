// Item import helpers. Pure functions — no React, no Supabase, no DOM — so the
// logic can be unit-tested from Node against the operator's real 2-column accounting
// sheet:
//
//   Column A = "Name"       (required — blank rows are skipped silently)
//   Column B = "HSN Code"   (optional — when present, used as the Item Code)
//
// ALL OTHER COLUMNS ARE IGNORED PER SPEC. Every other Item Master field is filled
// from DEFAULTS below, regardless of what the spreadsheet may contain. This matches
// the operator's actual workflow: they only maintain Name + HSN in their sheet, and
// everything else is edited in-app after import.

// ── Header aliases ──────────────────────────────────────────────────────────
// The matcher is generous so the operator can rename columns without breaking
// the importer. "Name" / "Item Name" / "Product" all map to name. "HSN" /
// "HSN Code" / "HSN No." / "HSN/SAC" / "Item Code" / "SKU" all map to code.
const NAME_ALIASES = [
  "item name", "name", "product name", "material name",
  "product", "item", "description",
];
const CODE_ALIASES = [
  "hsn code", "hsn", "hsn no", "hsn no.", "hsn number",
  "hsn/sac", "hsn / sac", "hsn sac",
  "item code", "code", "sku", "part number", "part no", "part no.",
];

// ── Defaults (per spec) ─────────────────────────────────────────────────────
// Every imported row gets these — the spreadsheet cannot override them.
export const ITEM_IMPORT_DEFAULTS = Object.freeze({
  stock:            0,
  min:              0,
  unit:             "Nos",
  category:         "Mechanical",
  location:         "",
  vendorLinks:      [],
  lastPurchaseRate: 0,
  photo:            null,
  designFile:       null,
  designName:       null,
});

// ── Header normalisation ────────────────────────────────────────────────────
// The matcher reduces both sides to a canonical form: lowercased, trimmed, with
// whitespace / dots / parens / dashes / underscores / slashes stripped. This is
// the only normalisation needed in practice because the operator's headers
// arrive in one of a small number of variants:
//   "Name" | "Item Name" | "Product Name"          → all canonical "name" / "itemname" / "productname"
//   "HSN Code" | "HSN" | "HSNCode" | "HSN No."     → all canonical "hsncode" / "hsn" / "hsnno"
// Stripping all separators on both the header AND the alias makes "HSNCode"
// (no space) and "HSN Code" (with space) compare equal — and "HSN/SAC" too.
const canonHeader = (s) => {
  let v = String(s == null ? "" : s).trim().toLowerCase();
  v = v.replace(/\([^)]*\)/g, "");           // drop parenthesized portions entirely
  v = v.replace(/[\s.()\-_/]+/g, "");        // collapse remaining separators
  return v;
};

export function matchAlias(headerName, aliases) {
  const c = canonHeader(headerName);
  if (!c) return false;
  for (const a of aliases) {
    if (canonHeader(a) === c) return true;
  }
  return false;
}

// ── Dynamic header-row detection ────────────────────────────────────────────
// The operator's accounting sheet starts with a title row ("List of Items")
// that's often a merged cell spanning the data columns. Row 2 is the real
// header (Name | HSN Code | Purc. Price | Sale Price). XLSX's default
// sheet_to_json treats row 1 as headers, so every "data" row comes out with
// a blank Name and is skipped silently.
//
// Fix: read the sheet as an Array-of-Arrays (XLSX.utils.sheet_to_json with
// header:1), then walk the first HEADER_SEARCH_LIMIT rows looking for one
// that looks like a header row, then build data objects from the rows below
// it. A header row is one whose cells contain — anywhere in the row —
// a name-alias match. We prefer rows that also contain an HSN/code match
// (operator's exact case), but fall back to name-only since HSN is optional.
//
// Returns { headerIndex, headers } where headers is the trimmed string row,
// or null when no plausible header was found within the search window.
export const HEADER_SEARCH_LIMIT = 10;

function isPlausibleHeaderRow(row) {
  if (!Array.isArray(row) || row.length === 0) return false;
  const cells = row.map((c) => (c == null ? "" : String(c).trim()));
  const hasName = cells.some((h) => h && matchAlias(h, NAME_ALIASES));
  const hasCode = cells.some((h) => h && matchAlias(h, CODE_ALIASES));
  return { hasName, hasCode, cells };
}

export function detectHeaderRow(rowsAOA) {
  if (!Array.isArray(rowsAOA)) return null;
  const limit = Math.min(HEADER_SEARCH_LIMIT, rowsAOA.length);

  // First pass: prefer a row that has BOTH Name + HSN/code — this is the
  // operator's exact case and unambiguously the header row.
  for (let i = 0; i < limit; i++) {
    const r = isPlausibleHeaderRow(rowsAOA[i]);
    if (r && r.hasName && r.hasCode) {
      return { headerIndex: i, headers: r.cells };
    }
  }
  // Second pass: accept Name-only (HSN is optional per spec) — covers a
  // sheet that uses just a single "Name" column.
  for (let i = 0; i < limit; i++) {
    const r = isPlausibleHeaderRow(rowsAOA[i]);
    if (r && r.hasName) {
      return { headerIndex: i, headers: r.cells };
    }
  }
  return null;
}

// Walks an Array-of-Arrays sheet, detects the header row, and returns the
// data rows below it converted to objects keyed by header name (the shape
// mapRow / parseRows expect). Title rows above the header are discarded.
// Fully empty data rows are dropped.
export function buildRowsFromSheet(rowsAOA) {
  const det = detectHeaderRow(rowsAOA);
  if (!det) return { headers: null, headerIndex: -1, rows: [] };
  const { headerIndex, headers } = det;
  const rows = [];
  for (let i = headerIndex + 1; i < rowsAOA.length; i++) {
    const r = rowsAOA[i];
    if (!Array.isArray(r)) continue;
    const obj = {};
    let anyValue = false;
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j];
      if (!key) continue;       // skip unnamed columns (e.g. trailing merged-cell blanks)
      const cell = r[j];
      if (cell != null && String(cell).trim() !== "") anyValue = true;
      obj[key] = cell != null ? cell : "";
    }
    if (anyValue) rows.push(obj);
  }
  return { headers, headerIndex, rows };
}

// ── Cell-value reader ───────────────────────────────────────────────────────
// HSN codes that arrive as JavaScript numbers ("84821011" → 84821011) get coerced
// back to text. String() is enough — XLSX always returns either a number or a
// string, never a float that would lose precision in the HSN range.
const readCell = (v) => (v == null ? "" : String(v).trim());

// ── Main row mapper ──────────────────────────────────────────────────────────
// Returns the full app-shaped item object: Name + Code from the sheet, every
// other field from DEFAULTS. The caller treats this output as the canonical
// source; the original spreadsheet row is discarded.
export function mapRow(raw) {
  const safe = raw && typeof raw === "object" ? raw : {};
  const nameKey = Object.keys(safe).find((k) => matchAlias(k, NAME_ALIASES));
  const codeKey = Object.keys(safe).find((k) => matchAlias(k, CODE_ALIASES));
  return {
    name: nameKey ? readCell(safe[nameKey]) : "",
    code: codeKey ? readCell(safe[codeKey]) : "",
    ...ITEM_IMPORT_DEFAULTS,
  };
}

// ── Classify rows: "ready" (new) / "update" (exists) / skip (blank name) ────
//
// Duplicate matching is two-tier so re-import is idempotent in BOTH cases:
//   1. If the row has a Code (HSN) → match against existing items by code.
//   2. Otherwise → fall back to matching by Name (case-insensitive).
//
// The fallback is important: rows without HSN have no stable identifier the
// app can echo back on the second import, so name is the only thing the
// operator can rely on to mean "this is the same item, please don't duplicate".
export function parseRows(rawRows, existingItems) {
  // existingItems can be the App's grouped state ({Mechanical:[…], Electrical:[…]})
  // OR a flat array (handy for tests). Normalise to flat.
  const flat = [];
  if (existingItems && typeof existingItems === "object" && !Array.isArray(existingItems)) {
    for (const [cat, list] of Object.entries(existingItems)) {
      if (Array.isArray(list)) for (const it of list) flat.push({ ...it, category: it.category || cat });
    }
  } else if (Array.isArray(existingItems)) {
    for (const it of existingItems) flat.push(it);
  }
  const byCode = new Map();
  const byName = new Map();
  for (const it of flat) {
    const c = String(it.code || "").trim().toUpperCase();
    const n = String(it.name || "").trim().toLowerCase();
    if (c) byCode.set(c, it);
    if (n) byName.set(n, it);
  }

  const out = [];
  for (const r of rawRows || []) {
    let mapped;
    try {
      mapped = mapRow(r);
    } catch {
      // Defensive: a single malformed row must not kill the batch. Skip silently.
      continue;
    }
    // Only Item Name is required (per spec). Blank name → skip silently.
    if (!mapped.name) continue;

    let match = null;
    if (mapped.code) match = byCode.get(mapped.code.toUpperCase()) || null;
    if (!match)      match = byName.get(mapped.name.toLowerCase()) || null;

    if (match) {
      out.push({
        ...mapped,
        _status:           "update",
        _existingCode:     match.code,
        _existingCategory: match.category,
        _matchedBy:        match.code && mapped.code && match.code.toUpperCase() === mapped.code.toUpperCase() ? "code" : "name",
      });
    } else {
      out.push({ ...mapped, _status: "ready" });
    }
  }
  return out;
}

// ── Code generator for items with no HSN ────────────────────────────────────
// Slug-from-name + 4-digit suffix. The App layer uses this when row.code is blank
// and we still need to insert the row (Name is the only mandatory column).
export function generateItemCode(name) {
  const slug = String(name || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
  const suffix = Math.floor(Math.random() * 9000 + 1000).toString();
  return slug ? `${slug}-${suffix}` : `ITEM-${Date.now().toString(36).toUpperCase()}`;
}
