// Node-only tests for src/utils/itemImport.js — verifies the operator's accounting
// sheet columns ("Name", "HSN Code", "Purc. Price", "Sale Price") map correctly,
// defaults are applied per spec, duplicates are detected by name, and bad rows are
// isolated. Run with:  node --test tests/itemImport.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ITEM_FIELDS, matchAlias, mapRow, parseRows, generateItemCode,
} from "../src/utils/itemImport.js";

test("ITEM_FIELDS includes all spec keys", () => {
  const keys = ITEM_FIELDS.map((f) => f.key);
  assert.ok(keys.includes("name"));
  assert.ok(keys.includes("unit"));
  assert.ok(keys.includes("category"));
  assert.ok(keys.includes("location"));
  assert.ok(keys.includes("stock"));
  assert.ok(keys.includes("min"));
  assert.ok(keys.includes("lastPurchaseRate"));
  assert.ok(keys.includes("salePrice"));
});

test("matchAlias — exact + case-insensitive + whitespace collapse", () => {
  assert.equal(matchAlias("Name", ["name"]), true);
  assert.equal(matchAlias("ITEM NAME", ["item name"]), true);
  assert.equal(matchAlias("  Item   Name  ", ["item name"]), true);
});

test("matchAlias — strips parens (operator's sheet: 'Purc. Price (₹)')", () => {
  assert.equal(matchAlias("Purc. Price (₹)", ["purc price"]), true);
  assert.equal(matchAlias("Opening Stock (Nos)", ["opening stock"]), true);
});

test("matchAlias — strips dots ('Purc. Price' → 'purc price')", () => {
  assert.equal(matchAlias("Purc. Price", ["purc price"]), true);
  assert.equal(matchAlias("HSN No.", ["hsn no"]), true);
});

test("mapRow — operator's exact sheet (Name + HSN Code + Purc. Price + Sale Price)", () => {
  const r = mapRow({
    "Name": "Spindle Bearing 6205 ZZ",
    "HSN Code": "84821011",
    "Purc. Price": 150,
    "Sale Price": 200,
  });
  assert.equal(r.name, "Spindle Bearing 6205 ZZ");
  assert.equal(r.code, "84821011");                 // HSN used as code when Item Code blank
  assert.equal(r.lastPurchaseRate, 150);
  assert.equal(r.salePrice, 200);
  assert.equal(r.unit, "Nos");                       // default
  assert.equal(r.category, "Mechanical");            // default
  assert.equal(r.location, "");                      // blank per spec
  assert.equal(r.stock, 0);                          // default
  assert.equal(r.min, 0);                            // default
});

test("mapRow — Item Code wins over HSN (priority per spec)", () => {
  const r = mapRow({
    "Name": "Test Item",
    "Item Code": "TEST-001",
    "HSN Code": "12345678",
  });
  assert.equal(r.code, "TEST-001");
});

test("mapRow — HSN fallback when Item Code blank", () => {
  const r = mapRow({
    "Name": "Test Item",
    "Item Code": "",
    "HSN Code": "12345678",
  });
  assert.equal(r.code, "12345678");
});

test("mapRow — Name only (every other column blank)", () => {
  const r = mapRow({ "Name": "Bare Item" });
  assert.equal(r.name, "Bare Item");
  assert.equal(r.code, "");
  assert.equal(r.lastPurchaseRate, 0);
  assert.equal(r.salePrice, null);                   // null when blank, NOT 0
  assert.equal(r.stock, 0);
  assert.equal(r.min, 0);
  assert.equal(r.unit, "Nos");
  assert.equal(r.category, "Mechanical");
});

test("mapRow — Sale Price stays null when blank (so App can decide to drop)", () => {
  const r = mapRow({ "Name": "X", "Purc. Price": 100 });
  assert.equal(r.salePrice, null);
});

test("mapRow — numeric cells (real numbers, not strings)", () => {
  const r = mapRow({
    "Name": "Numeric Item",
    "Purc. Price": 123.45,
    "Opening Stock": 50,
    "Min Stock": 10,
  });
  assert.equal(r.lastPurchaseRate, 123.45);
  assert.equal(r.stock, 50);
  assert.equal(r.min, 10);
});

test("mapRow — currency symbols stripped ('₹1,500.00' → 1500)", () => {
  const r = mapRow({ "Name": "X", "Purc. Price": "₹1,500.00" });
  assert.equal(r.lastPurchaseRate, 1500);
});

test("parseRows — blank Name skipped silently", () => {
  const out = parseRows([
    { "Name": "Good Item" },
    { "Name": "" },                                   // blank → skip
    { "Name": "   " },                                // whitespace-only → skip
    { },                                              // missing → skip
    { "Name": "Another Item" },
  ], {});
  assert.equal(out.length, 2);
  assert.equal(out[0].name, "Good Item");
  assert.equal(out[1].name, "Another Item");
});

test("parseRows — new items marked 'ready'", () => {
  const out = parseRows(
    [{ "Name": "Brand New" }],
    { Mechanical: [{ name: "Existing", code: "EX-1" }] }
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]._status, "ready");
});

test("parseRows — duplicate name (case-insensitive) → 'update'", () => {
  const out = parseRows(
    [{ "Name": "EXISTING ITEM" }],
    { Mechanical: [{ name: "Existing Item", code: "EX-1", category: "Mechanical" }] }
  );
  assert.equal(out.length, 1);
  assert.equal(out[0]._status, "update");
  assert.equal(out[0]._existingCode, "EX-1");
  assert.equal(out[0]._existingCategory, "Mechanical");
});

test("parseRows — accepts grouped object OR flat array for existingItems", () => {
  // grouped (App state)
  const grouped = parseRows([{ "Name": "X" }], { Cat: [{ name: "X" }] });
  assert.equal(grouped[0]._status, "update");
  // flat (test helper)
  const flat = parseRows([{ "Name": "X" }], [{ name: "X" }]);
  assert.equal(flat[0]._status, "update");
});

test("parseRows — handles null / undefined inputs safely", () => {
  assert.deepEqual(parseRows(null, {}), []);
  assert.deepEqual(parseRows([], null), []);
  assert.deepEqual(parseRows(undefined, undefined), []);
});

test("parseRows — bad row isolation (one bad row doesn't break batch)", () => {
  // mapRow should not throw on weird cell types
  const out = parseRows([
    { "Name": "Good Item" },
    { "Name": "Bad Numeric", "Purc. Price": "not-a-number" },
    { "Name": "Another Good" },
  ], {});
  assert.equal(out.length, 3);
  assert.equal(out[1].lastPurchaseRate, 0);          // unparseable → default 0
});

test("generateItemCode — uppercase + slug + 4-digit suffix", () => {
  const c = generateItemCode("Hydraulic Oil ISO 46");
  assert.match(c, /^HYDRAULICOIL-\d{4}$/);
});

test("generateItemCode — fallback when name has no alphanumerics", () => {
  const c = generateItemCode("!@#$%");
  assert.match(c, /^ITEM-[A-Z0-9]+$/);
});

test("generateItemCode — truncates long names to 12 chars before suffix", () => {
  const c = generateItemCode("Supercalifragilisticexpialidocious");
  const [slug] = c.split("-");
  assert.equal(slug.length, 12);
});

// ─── Integration: re-import idempotency ───────────────────────────────────────

test("re-import same sheet → all rows marked 'update' the second time", () => {
  const sheet = [
    { "Name": "Item A", "HSN Code": "111", "Purc. Price": 10 },
    { "Name": "Item B", "HSN Code": "222", "Purc. Price": 20 },
  ];
  const firstPass  = parseRows(sheet, {});
  assert.ok(firstPass.every((r) => r._status === "ready"));

  // Simulate App applying first pass → items state
  const appState = { Mechanical: firstPass.map((r) => ({ name: r.name, code: r.code, category: "Mechanical" })) };

  const secondPass = parseRows(sheet, appState);
  assert.ok(secondPass.every((r) => r._status === "update"));
});

test("operator's mixed sheet: Name + HSN + Purc. Price + Sale Price (4 rows)", () => {
  const out = parseRows([
    { "Name": "Bearing 6205",      "HSN Code": "84821011", "Purc. Price": "₹150", "Sale Price": "₹200" },
    { "Name": "V-Belt B-42",       "HSN Code": "40103990", "Purc. Price": 55,     "Sale Price": ""      },
    { "Name": "",                  "HSN Code": "XXXX",     "Purc. Price": 99 },         // blank name — skip
    { "Name": "Hydraulic Oil 46",  "HSN Code": "27101981", "Purc. Price": "₹37/L" },    // bad price → 37
  ], {});
  assert.equal(out.length, 3);
  assert.equal(out[0].name, "Bearing 6205");
  assert.equal(out[0].lastPurchaseRate, 150);
  assert.equal(out[0].salePrice, 200);
  assert.equal(out[1].lastPurchaseRate, 55);
  assert.equal(out[1].salePrice, null);              // blank → null
  assert.equal(out[2].name, "Hydraulic Oil 46");
  assert.equal(out[2].lastPurchaseRate, 37);         // "₹37/L" → 37 via parseFloat
});
