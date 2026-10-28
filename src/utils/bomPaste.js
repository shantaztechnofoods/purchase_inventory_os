// BOM "Paste from Excel" parser. Pure functions — no React, no Supabase, no
// DOM — so the whole thing is unit-testable from Node via node:test.
//
// Why this exists
// ---------------
// BOM components were only ever addable one line at a time (addItemToBOM in
// BOMDrawer, addCreateItem in OutwardPage's Create BOM modal). A 40-component
// machine meant 40 separate add actions. The operator's BOMs already live in
// Excel, so this parser turns a pasted block into BOM lines in one go.
//
// Accepted input
// --------------
// One row per line. Tab-separated (what Excel puts on the clipboard) with a
// comma-separated fallback. Two or three columns:
//
//     CODE <tab> QTY
//     CODE <tab> NAME/DESCRIPTION <tab> QTY
//
// The FIRST field is always the item code and the LAST field is always the
// quantity. Everything in between is a name / description column and is
// deliberately IGNORED — the inventory record is the authority on an item's
// name, never the spreadsheet. A single-field row is treated as a code with a
// blank quantity (→ default 1).
//
// A header row (e.g. "Code  Name  Qty") is detected and skipped. Blank lines,
// stray whitespace and a trailing newline are tolerated.
//
// Quantities: "2", "2.5", "2 Nos", "1,000" (thousands separator) and blank
// (→ DEFAULT_PASTE_QTY) all parse. Zero, negative and unparseable values are
// reported as problems and never become lines.
//
// Item-code matching
// ------------------
// The app resolves a code to an inventory row by exact equality on the `code`
// field (`findInv = (code) => allFlat.find((i) => i.code === code)` in
// BOMDrawer; `findItem` in OutwardPage). This parser does not introduce a
// second lookup rule: it still matches on the `code` field and nothing else.
// It only normalises the OPERATOR'S TYPING — trim + case-fold — before the
// comparison, and then hands back the inventory row's own canonical `code`, so
// every downstream findInv / findItem call keeps working unchanged. A pasted
// code that resolves to no inventory row is reported, never invented.
//
// Return shape
// ------------
// parseBomPaste(text, inventory, { existingLines }) returns:
//
//   {
//     lines: [{
//       code,             // canonical inventory code (from the inventory row)
//       name,             // inventory name  (never the pasted name column)
//       unit,             // inventory unit  ("" when the row has none)
//       category,         // inventory category ("" when the row has none)
//       qty,              // quantity contributed by this paste
//       rows: [Number],   // 1-based source row numbers that contributed
//       mergedFromPaste,  // true when the code appeared on >1 pasted row
//       existingInBom,    // true when the code is already a line in the BOM
//       existingQty,      // that line's current qty (0 when not in the BOM)
//       resultQty,        // existingQty + qty — what the line becomes
//     }],
//     unmatched: [{ row, code, qty }],          // code matched no inventory item
//     badQty:    [{ row, code, qty, reason }],  // reason: "zero" | "negative" | "invalid"
//     stats: {
//       dataRows,       // rows considered (blank + header rows excluded)
//       headerSkipped,  // true when a header row was detected and dropped
//       blankRows,
//       addedLines,     // lines whose code is NOT yet in the BOM
//       updatedLines,   // lines whose code IS already in the BOM (qty added on)
//       mergedLines,    // lines built from more than one pasted row
//     },
//   }
//
// `unmatched` / `badQty` carry the operator's own trimmed text so the preview
// can show exactly what they typed and they can fix it in Excel and paste
// again. `row` is the 1-based line number inside the pasted block (blank lines
// counted), so it lines up with the spreadsheet rows they copied.

// A blank quantity cell means "one per machine" — the overwhelmingly common
// case in the operator's sheets, and the same default the one-at-a-time
// add-component row starts at.
export const DEFAULT_PASTE_QTY = 1;

// Header-cell aliases. Mirrors the generous matcher in itemImport.js so the
// operator can rename columns without breaking the paste.
const CODE_HEADER_ALIASES = [
  "code", "item code", "itemcode", "component code", "part code",
  "part no", "part no.", "part number", "sku",
  "hsn", "hsn code", "hsn no", "hsn no.",
];
const QTY_HEADER_ALIASES = [
  "qty", "quantity", "qty/unit", "qty per unit", "per unit", "per machine",
  "nos", "no of", "no. of", "units", "unit qty", "base qty", "req qty",
  "required", "required qty",
];
const NAME_HEADER_ALIASES = [
  "name", "item name", "item", "description", "desc", "component",
  "component name", "material", "material name", "particulars",
];

// Same canonicalisation itemImport.js uses: lowercase, drop parenthesised
// portions, collapse separators. Makes "Qty / Unit", "qty/unit" and "QtyUnit"
// all compare equal.
const canonHeader = (s) => {
  let v = String(s == null ? "" : s).trim().toLowerCase();
  v = v.replace(/\([^)]*\)/g, "");
  v = v.replace(/[\s.()\-_/]+/g, "");
  return v;
};

function matchesAnyAlias(cell, aliases) {
  const c = canonHeader(cell);
  if (!c) return false;
  return aliases.some((a) => canonHeader(a) === c);
}

// Normalising an operator-typed code for LOOKUP ONLY. The canonical code we
// hand back always comes from the inventory row itself.
const canonCode = (s) => String(s == null ? "" : s).trim().toLowerCase();

// Quantities are operator-typed decimals, and merging sums them. Summing raw
// floats produces 0.30000000000000004-class artifacts that would be written
// onto the BOM line and shown in the preview, so every total is rounded back
// to four decimals — far finer than any quantity the shop floor uses.
const roundQty = (n) => Math.round(n * 10000) / 10000;

// ── Quantity parsing ────────────────────────────────────────────────────────
// Returns { qty } on success or { reason } on failure, where reason is one of
// "zero" | "negative" | "invalid". Blank → DEFAULT_PASTE_QTY.
export function parsePasteQuantity(raw) {
  const text = String(raw == null ? "" : raw).trim();
  if (!text) return { qty: DEFAULT_PASTE_QTY };

  // Thousands separators ("1,000"). Safe to strip wholesale here: by this
  // point the field has already been split off the row.
  const cleaned = text.replace(/,/g, "").trim();

  const m = cleaned.match(/^[-+]?\d*\.?\d+/);
  if (!m) return { reason: "invalid" };

  const num = parseFloat(m[0]);
  if (!Number.isFinite(num)) return { reason: "invalid" };

  // Whatever follows the number may only be a unit word ("2 Nos", "1.5 kg",
  // "3 pcs."). Trailing digits mean we misread the cell, so refuse it rather
  // than silently using the first number we found.
  const rest = cleaned.slice(m[0].length).trim();
  if (rest && !/^[A-Za-z%°'"/.\s-]+$/.test(rest)) return { reason: "invalid" };

  if (num === 0) return { reason: "zero" };
  if (num < 0)   return { reason: "negative" };
  return { qty: num };
}

// ── Row splitting ───────────────────────────────────────────────────────────
// Tab wins when the row contains one (Excel's clipboard format). Otherwise we
// fall back to comma. Decided per row so a mixed-delimiter paste still works.
//
// In comma mode a thousands separator would otherwise be split into its own
// field ("1,000" → "1" + "000"), so digit-comma-three-digits groups are
// collapsed before the split. Tab mode needs no such repair.
export function splitPasteRow(line) {
  const raw = String(line == null ? "" : line).replace(/\r$/, "");
  if (raw.includes("\t")) {
    return raw.split("\t").map((c) => c.trim());
  }
  const collapsed = raw.replace(/(\d),(\d{3})(?=\D|$)/g, "$1$2");
  return collapsed.split(",").map((c) => c.trim());
}

// First field = code, last field = quantity, anything between = the ignored
// name/description column. A single field is a code with no quantity.
// Empty cells on either end are dropped first, so a paste that carried a
// leading or trailing blank spreadsheet column still reads correctly.
function fieldsToRow(cells) {
  const trimmed = [...cells];
  while (trimmed.length > 1 && trimmed[trimmed.length - 1] === "") trimmed.pop();
  while (trimmed.length > 1 && trimmed[0] === "") trimmed.shift();
  const code = trimmed[0] || "";
  const qty  = trimmed.length > 1 ? trimmed[trimmed.length - 1] : "";
  const middle = trimmed.slice(1, Math.max(1, trimmed.length - 1));
  return { code, qty, middle };
}

// A row is a header row when its code cell or its quantity cell reads like a
// column title (and the middle cell reading like "Name" counts too). The
// caller only offers the first non-blank row, and only when its code does not
// resolve to a real inventory item — so a genuine item coded "CODE" is safe.
function looksLikeHeaderRow({ code, qty, middle }) {
  if (matchesAnyAlias(code, CODE_HEADER_ALIASES)) return true;
  if (matchesAnyAlias(qty,  QTY_HEADER_ALIASES))  return true;
  if (middle.some((c) => matchesAnyAlias(c, NAME_HEADER_ALIASES))) return true;
  return false;
}

// ── Inventory index ─────────────────────────────────────────────────────────
// Normalised code → inventory row. Earliest wins when a normalised code is
// duplicated (two rows differing only by case), which keeps the result stable
// and matches `Array.prototype.find`'s first-hit behaviour in findInv.
function indexInventory(inventory) {
  const byCode = new Map();
  if (!Array.isArray(inventory)) return byCode;
  for (const it of inventory) {
    if (!it) continue;
    const key = canonCode(it.code);
    if (!key) continue;
    if (!byCode.has(key)) byCode.set(key, it);
  }
  return byCode;
}

/**
 * Parse a block pasted out of Excel into BOM lines.
 *
 * @param {string} text        the pasted clipboard text
 * @param {Array}  inventory   flat inventory list: [{ code, name, unit, category }]
 * @param {Object} [options]
 * @param {Array}  [options.existingLines]  lines already in the BOM being
 *                 edited: [{ code, qty }]. Used so a pasted code that is
 *                 already present reports as an update (quantity added to the
 *                 existing line) instead of a duplicate line.
 * @returns {Object} see "Return shape" at the top of this file.
 */
export function parseBomPaste(text, inventory, options = {}) {
  const byCode   = indexInventory(inventory);
  const existing = new Map();
  for (const l of options.existingLines || []) {
    if (!l) continue;
    const key = canonCode(l.code);
    if (!key) continue;
    // Later duplicates shouldn't happen (both editors block them), but sum
    // defensively rather than lose a quantity.
    existing.set(key, (existing.get(key) || 0) + (Number(l.qty) || 0));
  }

  const result = {
    lines: [],
    unmatched: [],
    badQty: [],
    stats: {
      dataRows: 0,
      headerSkipped: false,
      blankRows: 0,
      addedLines: 0,
      updatedLines: 0,
      mergedLines: 0,
    },
  };

  const rawText = typeof text === "string" ? text : "";
  if (!rawText.trim()) return result;

  const rawLines = rawText.split("\n");
  const byLineCode = new Map();   // canonical code → index into result.lines
  let seenFirstDataRow = false;

  for (let i = 0; i < rawLines.length; i++) {
    const rowNo = i + 1;
    const cells = splitPasteRow(rawLines[i]);

    if (cells.every((c) => c === "")) { result.stats.blankRows++; continue; }

    const row = fieldsToRow(cells);
    if (!row.code) { result.stats.blankRows++; continue; }

    const inv = byCode.get(canonCode(row.code));

    // Header detection: only ever the first non-blank row, and only when it
    // isn't itself a real item.
    if (!seenFirstDataRow && !inv && looksLikeHeaderRow(row)) {
      seenFirstDataRow = true;
      result.stats.headerSkipped = true;
      continue;
    }
    seenFirstDataRow = true;
    result.stats.dataRows++;

    if (!inv) {
      result.unmatched.push({ row: rowNo, code: row.code, qty: row.qty });
      continue;
    }

    const parsed = parsePasteQuantity(row.qty);
    if (parsed.reason) {
      result.badQty.push({ row: rowNo, code: inv.code, qty: row.qty, reason: parsed.reason });
      continue;
    }

    const key = canonCode(inv.code);
    const at  = byLineCode.get(key);
    if (at === undefined) {
      const existingQty = existing.has(key) ? existing.get(key) : 0;
      byLineCode.set(key, result.lines.length);
      result.lines.push({
        code: inv.code,
        name: inv.name || inv.code,
        unit: inv.unit || "",
        category: inv.category || "",
        qty: parsed.qty,
        rows: [rowNo],
        mergedFromPaste: false,
        existingInBom: existing.has(key),
        existingQty,
        resultQty: roundQty(existingQty + parsed.qty),
      });
    } else {
      const line = result.lines[at];
      line.qty = roundQty(line.qty + parsed.qty);
      line.rows.push(rowNo);
      line.mergedFromPaste = true;
      line.resultQty = roundQty(line.existingQty + line.qty);
    }
  }

  for (const line of result.lines) {
    if (line.mergedFromPaste) result.stats.mergedLines++;
    if (line.existingInBom)   result.stats.updatedLines++;
    else                      result.stats.addedLines++;
  }

  return result;
}
