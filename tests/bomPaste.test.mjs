// Unit tests for src/utils/bomPaste.js — pure functions, no React.
//
// These cover the real-world mess an Excel paste arrives with: tabs, commas,
// two or three columns, a header row, blank lines, trailing newlines, units
// glued to the quantity, thousands separators, mixed-case codes, the same code
// twice in one block, codes that match nothing, and zero / negative / garbage
// quantities.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PASTE_QTY,
  parseBomPaste,
  parsePasteQuantity,
  splitPasteRow,
} from "../src/utils/bomPaste.js";

// A stand-in for the flat inventory list both BOM editors build from `items`.
// Note MOT-01 vs mot-01 casing and the padded " BRG-22 " code the operator
// types — both exercised below.
const INV = [
  { code: "MOT-01", name: "Motor 2HP",      unit: "Nos", category: "Electrical" },
  { code: "BRG-22", name: "Bearing 6204",   unit: "Nos", category: "Mechanical" },
  { code: "BLT-05", name: "Bolt M8x40",     unit: "Nos", category: "Hardware"   },
  { code: "SHT-10", name: "SS Sheet 2mm",   unit: "Kg",  category: "Raw"        },
  { code: "WIR-07", name: "Cable 2.5sqmm",  unit: "Mtr", category: "Electrical" },
];

const codes = (r) => r.lines.map((l) => l.code);
const qtyOf = (r, code) => r.lines.find((l) => l.code === code)?.qty;

// ─── parsePasteQuantity ─────────────────────────────────────────────────────

test("parsePasteQuantity: plain integer", () => {
  assert.deepEqual(parsePasteQuantity("2"), { qty: 2 });
});

test("parsePasteQuantity: decimal", () => {
  assert.deepEqual(parsePasteQuantity("2.5"), { qty: 2.5 });
});

test("parsePasteQuantity: quantity with a unit word glued on", () => {
  assert.deepEqual(parsePasteQuantity("2 Nos"), { qty: 2 });
  assert.deepEqual(parsePasteQuantity("1.5 kg"), { qty: 1.5 });
  assert.deepEqual(parsePasteQuantity("3 pcs."), { qty: 3 });
  assert.deepEqual(parsePasteQuantity("4Nos"), { qty: 4 });
});

test("parsePasteQuantity: thousands separator", () => {
  assert.deepEqual(parsePasteQuantity("1,000"), { qty: 1000 });
  assert.deepEqual(parsePasteQuantity("12,500.5"), { qty: 12500.5 });
});

test("parsePasteQuantity: blank falls back to the default of 1", () => {
  assert.deepEqual(parsePasteQuantity(""), { qty: DEFAULT_PASTE_QTY });
  assert.deepEqual(parsePasteQuantity("   "), { qty: DEFAULT_PASTE_QTY });
  assert.deepEqual(parsePasteQuantity(null), { qty: DEFAULT_PASTE_QTY });
  assert.deepEqual(parsePasteQuantity(undefined), { qty: DEFAULT_PASTE_QTY });
  assert.equal(DEFAULT_PASTE_QTY, 1);
});

test("parsePasteQuantity: zero and negative are problems, not lines", () => {
  assert.deepEqual(parsePasteQuantity("0"),    { reason: "zero" });
  assert.deepEqual(parsePasteQuantity("0.0"),  { reason: "zero" });
  assert.deepEqual(parsePasteQuantity("-3"),   { reason: "negative" });
  assert.deepEqual(parsePasteQuantity("-0.5"), { reason: "negative" });
});

test("parsePasteQuantity: unparseable text is a problem", () => {
  assert.deepEqual(parsePasteQuantity("abc"),   { reason: "invalid" });
  assert.deepEqual(parsePasteQuantity("Motor"), { reason: "invalid" });
  assert.deepEqual(parsePasteQuantity("~"),     { reason: "invalid" });
});

test("parsePasteQuantity: refuses a cell holding two numbers rather than guessing", () => {
  // "2 3" almost certainly means the columns were misread; taking the 2 would
  // silently put a wrong quantity on the BOM.
  assert.deepEqual(parsePasteQuantity("2 3"), { reason: "invalid" });
});

// ─── splitPasteRow ──────────────────────────────────────────────────────────

test("splitPasteRow: tab wins when the row has tabs", () => {
  assert.deepEqual(splitPasteRow("MOT-01\tMotor 2HP\t2"), ["MOT-01", "Motor 2HP", "2"]);
});

test("splitPasteRow: comma is the fallback", () => {
  assert.deepEqual(splitPasteRow("MOT-01,2"), ["MOT-01", "2"]);
});

test("splitPasteRow: trims each cell and strips a trailing carriage return", () => {
  assert.deepEqual(splitPasteRow("  MOT-01 \t  2  \r"), ["MOT-01", "2"]);
});

test("splitPasteRow: comma mode keeps a thousands separator intact", () => {
  // Without the repair this would split into "1" and "000".
  assert.deepEqual(splitPasteRow("SHT-10,Sheet,1,000"), ["SHT-10", "Sheet", "1000"]);
});

// ─── Happy paths: tab and comma, two and three columns ──────────────────────

test("parseBomPaste: tab-separated two columns", () => {
  const r = parseBomPaste("MOT-01\t2\nBRG-22\t4", INV);
  assert.deepEqual(codes(r), ["MOT-01", "BRG-22"]);
  assert.equal(qtyOf(r, "MOT-01"), 2);
  assert.equal(qtyOf(r, "BRG-22"), 4);
  assert.equal(r.unmatched.length, 0);
  assert.equal(r.badQty.length, 0);
  assert.equal(r.stats.dataRows, 2);
  assert.equal(r.stats.addedLines, 2);
});

test("parseBomPaste: tab-separated three columns ignores the middle name column", () => {
  const r = parseBomPaste("MOT-01\tWRONG NAME FROM SHEET\t2", INV);
  assert.equal(r.lines.length, 1);
  // The inventory record is the authority on the name — never the paste.
  assert.equal(r.lines[0].name, "Motor 2HP");
  assert.equal(r.lines[0].unit, "Nos");
  assert.equal(r.lines[0].category, "Electrical");
  assert.equal(r.lines[0].qty, 2);
});

test("parseBomPaste: comma-separated two and three columns", () => {
  const two = parseBomPaste("MOT-01,2\nBRG-22,4", INV);
  assert.deepEqual(codes(two), ["MOT-01", "BRG-22"]);
  assert.equal(qtyOf(two, "BRG-22"), 4);

  const three = parseBomPaste("MOT-01,Motor,2\nBRG-22,Bearing,4", INV);
  assert.deepEqual(codes(three), ["MOT-01", "BRG-22"]);
  assert.equal(three.lines[0].name, "Motor 2HP");
});

test("parseBomPaste: a single column is a code with the default quantity", () => {
  const r = parseBomPaste("MOT-01\nBRG-22", INV);
  assert.deepEqual(codes(r), ["MOT-01", "BRG-22"]);
  assert.equal(qtyOf(r, "MOT-01"), DEFAULT_PASTE_QTY);
  assert.equal(qtyOf(r, "BRG-22"), DEFAULT_PASTE_QTY);
});

test("parseBomPaste: a blank quantity cell falls back to the default", () => {
  const r = parseBomPaste("MOT-01\t\nBRG-22\t3", INV);
  assert.equal(qtyOf(r, "MOT-01"), DEFAULT_PASTE_QTY);
  assert.equal(qtyOf(r, "BRG-22"), 3);
  assert.equal(r.badQty.length, 0);
});

test("parseBomPaste: a 40-row paste is handled in one go", () => {
  // The whole point of the feature: the operator stops doing 40 add actions.
  const rows = [];
  for (let i = 0; i < 40; i++) rows.push(`${INV[i % INV.length].code}\t1`);
  const r = parseBomPaste(rows.join("\n"), INV);
  // 40 rows across 5 distinct codes → 5 merged lines of qty 8 each.
  assert.equal(r.stats.dataRows, 40);
  assert.equal(r.lines.length, 5);
  for (const l of r.lines) assert.equal(l.qty, 8);
  assert.equal(r.unmatched.length, 0);
  assert.equal(r.badQty.length, 0);
});

// ─── Header row ─────────────────────────────────────────────────────────────

test("parseBomPaste: a Code/Name/Qty header row is detected and skipped", () => {
  const r = parseBomPaste("Code\tName\tQty\nMOT-01\tMotor\t2", INV);
  assert.equal(r.stats.headerSkipped, true);
  assert.deepEqual(codes(r), ["MOT-01"]);
  assert.equal(r.unmatched.length, 0, "the header must not surface as an unmatched code");
  assert.equal(r.stats.dataRows, 1);
});

test("parseBomPaste: header aliases are matched generously", () => {
  for (const header of [
    "Item Code\tDescription\tQuantity",
    "Part No.\tParticulars\tQty / Unit",
    "SKU\tMaterial Name\tNos",
    "Code\tQty",
  ]) {
    const r = parseBomPaste(`${header}\nMOT-01\t2`, INV);
    assert.equal(r.stats.headerSkipped, true, `header not detected: ${header}`);
    assert.deepEqual(codes(r), ["MOT-01"]);
  }
});

test("parseBomPaste: only the first row can be a header", () => {
  // A header-looking row further down is data, so it is reported as unmatched
  // rather than silently dropped.
  const r = parseBomPaste("MOT-01\t2\nCode\tQty\nBRG-22\t1", INV);
  assert.equal(r.stats.headerSkipped, false);
  assert.deepEqual(codes(r), ["MOT-01", "BRG-22"]);
  assert.equal(r.unmatched.length, 1);
  assert.equal(r.unmatched[0].code, "Code");
  assert.equal(r.unmatched[0].row, 2);
});

test("parseBomPaste: a real item is never mistaken for a header", () => {
  const inv = [...INV, { code: "CODE", name: "Coded Plate", unit: "Nos", category: "Misc" }];
  const r = parseBomPaste("CODE\t2\nMOT-01\t1", inv);
  assert.equal(r.stats.headerSkipped, false);
  assert.deepEqual(codes(r), ["CODE", "MOT-01"]);
});

test("parseBomPaste: no header at all is fine", () => {
  const r = parseBomPaste("MOT-01\t2", INV);
  assert.equal(r.stats.headerSkipped, false);
  assert.equal(r.lines.length, 1);
});

// ─── Blank lines, whitespace, trailing newline ──────────────────────────────

test("parseBomPaste: blank lines, padding and a trailing newline survive", () => {
  const text = "\n  MOT-01 \t 2 \n\n\tBRG-22\t4\n   \nSHT-10\t1.5\n\n";
  const r = parseBomPaste(text, INV);
  assert.deepEqual(codes(r), ["MOT-01", "BRG-22", "SHT-10"]);
  assert.equal(qtyOf(r, "SHT-10"), 1.5);
  assert.equal(r.unmatched.length, 0);
  assert.equal(r.badQty.length, 0);
  assert.ok(r.stats.blankRows >= 4);
});

test("parseBomPaste: CRLF line endings", () => {
  const r = parseBomPaste("MOT-01\t2\r\nBRG-22\t4\r\n", INV);
  assert.deepEqual(codes(r), ["MOT-01", "BRG-22"]);
  assert.equal(qtyOf(r, "BRG-22"), 4);
});

test("parseBomPaste: empty / whitespace-only / non-string input returns an empty result", () => {
  for (const input of ["", "   \n\n ", null, undefined, 42, {}]) {
    const r = parseBomPaste(input, INV);
    assert.equal(r.lines.length, 0);
    assert.equal(r.unmatched.length, 0);
    assert.equal(r.badQty.length, 0);
    assert.equal(r.stats.dataRows, 0);
  }
});

test("parseBomPaste: a leading blank spreadsheet column is tolerated", () => {
  const r = parseBomPaste("\tMOT-01\t2", INV);
  assert.deepEqual(codes(r), ["MOT-01"]);
  assert.equal(qtyOf(r, "MOT-01"), 2);
});

test("parseBomPaste: a trailing blank spreadsheet column is tolerated", () => {
  const r = parseBomPaste("MOT-01\t2\t\t", INV);
  assert.deepEqual(codes(r), ["MOT-01"]);
  assert.equal(qtyOf(r, "MOT-01"), 2);
});

// ─── Code matching ──────────────────────────────────────────────────────────

test("parseBomPaste: code matching is case-insensitive and whitespace-trimmed", () => {
  const r = parseBomPaste("  mot-01  \t2\nBrG-22\t3", INV);
  // The canonical inventory code comes back, so downstream findInv() still
  // resolves the line.
  assert.deepEqual(codes(r), ["MOT-01", "BRG-22"]);
  assert.equal(qtyOf(r, "MOT-01"), 2);
  assert.equal(qtyOf(r, "BRG-22"), 3);
});

test("parseBomPaste: an unknown code is reported with its row number, never invented", () => {
  const r = parseBomPaste("MOT-01\t2\nNOPE-99\t5\nBRG-22\t1", INV);
  assert.deepEqual(codes(r), ["MOT-01", "BRG-22"]);
  assert.equal(r.unmatched.length, 1);
  assert.deepEqual(r.unmatched[0], { row: 2, code: "NOPE-99", qty: "5" });
  // No phantom inventory item was conjured for it.
  assert.ok(!r.lines.some((l) => l.code === "NOPE-99"));
});

test("parseBomPaste: every unmatched row is reported, with the operator's own text", () => {
  const r = parseBomPaste("GHOST-1\t2\nGHOST-2\tSome Name\t3", INV);
  assert.equal(r.lines.length, 0);
  assert.equal(r.unmatched.length, 2);
  assert.deepEqual(r.unmatched.map((u) => u.code), ["GHOST-1", "GHOST-2"]);
  assert.deepEqual(r.unmatched.map((u) => u.row), [1, 2]);
});

test("parseBomPaste: an unknown code with a bad quantity is reported as unmatched only", () => {
  // Unmatched is the actionable problem; don't double-report the same row.
  const r = parseBomPaste("GHOST-1\t0", INV);
  assert.equal(r.unmatched.length, 1);
  assert.equal(r.badQty.length, 0);
});

test("parseBomPaste: an empty / missing inventory list matches nothing but still reports", () => {
  for (const inv of [[], null, undefined]) {
    const r = parseBomPaste("MOT-01\t2", inv);
    assert.equal(r.lines.length, 0);
    assert.equal(r.unmatched.length, 1);
    assert.equal(r.unmatched[0].code, "MOT-01");
  }
});

test("parseBomPaste: inventory rows without a code are ignored safely", () => {
  const inv = [null, { name: "no code" }, { code: "", name: "blank" }, ...INV];
  const r = parseBomPaste("MOT-01\t2", inv);
  assert.deepEqual(codes(r), ["MOT-01"]);
});

// ─── Duplicate codes inside one paste ───────────────────────────────────────

test("parseBomPaste: the same code twice merges into one line with quantities summed", () => {
  const r = parseBomPaste("MOT-01\t2\nBRG-22\t1\nMOT-01\t3", INV);
  assert.equal(r.lines.length, 2, "must be one line per code, not a duplicate line");
  const mot = r.lines.find((l) => l.code === "MOT-01");
  assert.equal(mot.qty, 5);
  assert.equal(mot.mergedFromPaste, true, "the merge must be reported to the user");
  assert.deepEqual(mot.rows, [1, 3]);
  assert.equal(r.stats.mergedLines, 1);
  // The untouched line is not flagged as merged.
  assert.equal(r.lines.find((l) => l.code === "BRG-22").mergedFromPaste, false);
});

test("parseBomPaste: duplicate codes merge across different casing and padding", () => {
  const r = parseBomPaste("MOT-01\t2\n mot-01 \t2.5", INV);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].qty, 4.5);
  assert.equal(r.lines[0].mergedFromPaste, true);
});

test("parseBomPaste: a duplicate row with a bad quantity contributes nothing but is reported", () => {
  const r = parseBomPaste("MOT-01\t2\nMOT-01\t0", INV);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].qty, 2);
  assert.equal(r.lines[0].mergedFromPaste, false);
  assert.equal(r.badQty.length, 1);
  assert.equal(r.badQty[0].row, 2);
  assert.equal(r.badQty[0].reason, "zero");
});

test("parseBomPaste: merged decimal quantities do not leak float artifacts", () => {
  // 0.1 + 0.2 === 0.30000000000000004 in raw float arithmetic, which would be
  // written onto the BOM line and shown in the preview.
  const r = parseBomPaste("SHT-10\t0.1\nSHT-10\t0.2", INV, {
    existingLines: [{ code: "SHT-10", qty: 0.1 }],
  });
  assert.equal(r.lines[0].qty, 0.3);
  assert.equal(r.lines[0].resultQty, 0.4);
});

test("parseBomPaste: merged quantity keeps three or more occurrences", () => {
  const r = parseBomPaste("BLT-05\t4\nBLT-05\t4\nBLT-05\t8", INV);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].qty, 16);
  assert.deepEqual(r.lines[0].rows, [1, 2, 3]);
});

// ─── Bad quantities ─────────────────────────────────────────────────────────

test("parseBomPaste: zero and negative quantities become problems, not lines", () => {
  const r = parseBomPaste("MOT-01\t0\nBRG-22\t-2\nBLT-05\t4", INV);
  assert.deepEqual(codes(r), ["BLT-05"]);
  assert.equal(r.badQty.length, 2);
  assert.deepEqual(r.badQty[0], { row: 1, code: "MOT-01", qty: "0", reason: "zero" });
  assert.deepEqual(r.badQty[1], { row: 2, code: "BRG-22", qty: "-2", reason: "negative" });
});

test("parseBomPaste: an unparseable quantity becomes a problem", () => {
  const r = parseBomPaste("MOT-01\tmany", INV);
  assert.equal(r.lines.length, 0);
  assert.equal(r.badQty.length, 1);
  assert.equal(r.badQty[0].reason, "invalid");
  assert.equal(r.badQty[0].qty, "many");
});

test("parseBomPaste: bad-quantity rows carry the canonical code so the preview is unambiguous", () => {
  const r = parseBomPaste("mot-01\t0", INV);
  assert.equal(r.badQty[0].code, "MOT-01");
});

// ─── Already a line in the BOM being edited ─────────────────────────────────

test("parseBomPaste: a code already in the BOM is an update, not a duplicate line", () => {
  const r = parseBomPaste("MOT-01\t3\nBRG-22\t2", INV, {
    existingLines: [{ code: "MOT-01", qty: 4 }],
  });
  assert.equal(r.lines.length, 2);
  const mot = r.lines.find((l) => l.code === "MOT-01");
  assert.equal(mot.existingInBom, true);
  assert.equal(mot.existingQty, 4);
  assert.equal(mot.qty, 3);
  assert.equal(mot.resultQty, 7, "the pasted quantity is added to the existing line");
  const brg = r.lines.find((l) => l.code === "BRG-22");
  assert.equal(brg.existingInBom, false);
  assert.equal(brg.existingQty, 0);
  assert.equal(brg.resultQty, 2);
  assert.equal(r.stats.updatedLines, 1);
  assert.equal(r.stats.addedLines, 1);
});

test("parseBomPaste: existing-line matching is case-insensitive too", () => {
  const r = parseBomPaste("mot-01\t1", INV, { existingLines: [{ code: "MOT-01", qty: 2 }] });
  assert.equal(r.lines[0].existingInBom, true);
  assert.equal(r.lines[0].resultQty, 3);
});

test("parseBomPaste: in-paste merge and in-BOM merge combine correctly", () => {
  const r = parseBomPaste("MOT-01\t2\nMOT-01\t3", INV, {
    existingLines: [{ code: "MOT-01", qty: 10 }],
  });
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].qty, 5);
  assert.equal(r.lines[0].existingQty, 10);
  assert.equal(r.lines[0].resultQty, 15);
  assert.equal(r.lines[0].mergedFromPaste, true);
  assert.equal(r.lines[0].existingInBom, true);
});

test("parseBomPaste: no existingLines option means nothing is flagged as existing", () => {
  const r = parseBomPaste("MOT-01\t2", INV);
  assert.equal(r.lines[0].existingInBom, false);
  assert.equal(r.lines[0].existingQty, 0);
  assert.equal(r.lines[0].resultQty, 2);
});

test("parseBomPaste: junk entries in existingLines are ignored", () => {
  const r = parseBomPaste("MOT-01\t2", INV, {
    existingLines: [null, { qty: 3 }, { code: "", qty: 9 }, { code: "MOT-01", qty: "bad" }],
  });
  assert.equal(r.lines[0].existingInBom, true);
  // Number("bad") is NaN → treated as 0 rather than poisoning the total.
  assert.equal(r.lines[0].existingQty, 0);
  assert.equal(r.lines[0].resultQty, 2);
});

// ─── Everything at once ─────────────────────────────────────────────────────

test("parseBomPaste: a realistically messy paste splits cleanly into three buckets", () => {
  const text = [
    "Code\tComponent\tQty",       // header
    "MOT-01\tMotor 2HP\t2",       // plain
    "",                            // blank
    " brg-22 \tBearing\t 4 Nos ",  // messy casing + unit suffix
    "SHT-10\tSS Sheet\t1,000",     // thousands separator
    "NOPE-99\tGhost Part\t3",      // unmatched
    "BLT-05\tBolt\t0",             // zero
    "WIR-07\tCable\t-5",           // negative
    "MOT-01\tMotor 2HP\t1",        // duplicate of row 2
    "BRG-22\tBearing\tlots",       // unparseable
    "",                            // trailing blank
  ].join("\n") + "\n";

  const r = parseBomPaste(text, INV, { existingLines: [{ code: "SHT-10", qty: 2 }] });

  assert.equal(r.stats.headerSkipped, true);

  // Lines that will be added.
  assert.deepEqual(codes(r), ["MOT-01", "BRG-22", "SHT-10"]);
  assert.equal(qtyOf(r, "MOT-01"), 3);      // 2 + 1, merged
  assert.equal(qtyOf(r, "BRG-22"), 4);      // "4 Nos"
  assert.equal(qtyOf(r, "SHT-10"), 1000);   // "1,000"
  assert.equal(r.lines.find((l) => l.code === "MOT-01").mergedFromPaste, true);
  const sht = r.lines.find((l) => l.code === "SHT-10");
  assert.equal(sht.existingInBom, true);
  assert.equal(sht.resultQty, 1002);

  // Rows that could not be matched.
  assert.deepEqual(r.unmatched.map((u) => [u.row, u.code]), [[6, "NOPE-99"]]);

  // Rows with a bad quantity.
  assert.deepEqual(
    r.badQty.map((b) => [b.row, b.code, b.reason]),
    [[7, "BLT-05", "zero"], [8, "WIR-07", "negative"], [10, "BRG-22", "invalid"]]
  );

  assert.equal(r.stats.addedLines, 2);
  assert.equal(r.stats.updatedLines, 1);
  assert.equal(r.stats.mergedLines, 1);
  // Rows 2, 4, 5, 6, 7, 8, 9 and 10 — the header and the three blanks excluded.
  assert.equal(r.stats.dataRows, 8);
});

test("parseBomPaste: the result never mutates its inputs", () => {
  const inv = INV.map((i) => ({ ...i }));
  const existingLines = [{ code: "MOT-01", qty: 4 }];
  const snapshotInv = JSON.stringify(inv);
  const snapshotEx  = JSON.stringify(existingLines);
  parseBomPaste("MOT-01\t2\nBRG-22\t1", inv, { existingLines });
  assert.equal(JSON.stringify(inv), snapshotInv);
  assert.equal(JSON.stringify(existingLines), snapshotEx);
});
