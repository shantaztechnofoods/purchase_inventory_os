// Node-only tests for src/utils/itemImport.js — verifies the operator's actual
// 2-column accounting sheet (Name + HSN Code) maps correctly, defaults are applied
// per spec, duplicates are detected by Code first / Name fallback, re-import is
// idempotent, and bad rows are isolated. Run with:
//
//   node --test tests/itemImport.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ITEM_IMPORT_DEFAULTS, matchAlias, mapRow, parseRows, generateItemCode,
} from "../src/utils/itemImport.js";

// ── matchAlias ──────────────────────────────────────────────────────────────

test("matchAlias — exact, case-insensitive, whitespace-collapsed", () => {
  assert.equal(matchAlias("Name", ["name"]), true);
  assert.equal(matchAlias("ITEM NAME", ["item name"]), true);
  assert.equal(matchAlias("  Item   Name  ", ["item name"]), true);
});

test("matchAlias — strips parens (so 'HSN Code (8 digit)' still matches)", () => {
  assert.equal(matchAlias("HSN Code (8 digit)", ["hsn code"]), true);
  assert.equal(matchAlias("Name (English)",      ["name"]),     true);
});

test("matchAlias — strips dots ('HSN No.' → 'hsn no')", () => {
  assert.equal(matchAlias("HSN No.", ["hsn no"]), true);
});

// ── mapRow — Name only ──────────────────────────────────────────────────────

test("mapRow — Name only (every other column blank): defaults applied", () => {
  const r = mapRow({ "Name": "Spindle Bearing 6205 ZZ" });
  assert.equal(r.name,             "Spindle Bearing 6205 ZZ");
  assert.equal(r.code,             "");                       // no HSN → blank, App auto-gens
  assert.equal(r.unit,             "Nos");
  assert.equal(r.category,         "Mechanical");
  assert.equal(r.stock,            0);
  assert.equal(r.min,              0);
  assert.equal(r.location,         "");
  assert.deepEqual(r.vendorLinks,  []);
  assert.equal(r.lastPurchaseRate, 0);
  assert.equal(r.photo,            null);
  assert.equal(r.designFile,       null);
  assert.equal(r.designName,       null);
});

// ── mapRow — Name + HSN ─────────────────────────────────────────────────────

test("mapRow — Name + HSN Code: HSN becomes the Item Code", () => {
  const r = mapRow({ "Name": "Spindle Oil ISO 10", "HSN Code": "27101981" });
  assert.equal(r.name, "Spindle Oil ISO 10");
  assert.equal(r.code, "27101981");
  // Defaults still apply for the non-spec columns
  assert.equal(r.unit,     "Nos");
  assert.equal(r.category, "Mechanical");
  assert.equal(r.stock,    0);
});

test("mapRow — HSN delivered as a Number by XLSX (84821011) coerces to string", () => {
  const r = mapRow({ "Name": "Bearing", "HSN Code": 84821011 });
  assert.equal(r.code, "84821011");
});

test("mapRow — alternative HSN headers all work ('HSN', 'HSN No.', 'HSN/SAC')", () => {
  assert.equal(mapRow({ "Name": "A", "HSN":      "111" }).code, "111");
  assert.equal(mapRow({ "Name": "B", "HSN No.":  "222" }).code, "222");
  assert.equal(mapRow({ "Name": "C", "HSN/SAC":  "333" }).code, "333");
});

test("mapRow — other columns in the sheet are IGNORED per spec", () => {
  // Sheet has extra junk columns; importer must not pull anything from them
  const r = mapRow({
    "Name":         "Hydraulic Oil",
    "HSN Code":     "27101981",
    "Purc. Price":  500,
    "Sale Price":   650,
    "Stock":        99,
    "Min":          50,
    "Unit":         "Ltrs",
    "Category":     "Lubricants",
    "Location":     "Tank B-1",
    "Random Col":   "anything",
  });
  assert.equal(r.name, "Hydraulic Oil");
  assert.equal(r.code, "27101981");
  // Spec: every other field MUST come from defaults — sheet values ignored
  assert.equal(r.unit,             "Nos");
  assert.equal(r.category,         "Mechanical");
  assert.equal(r.stock,            0);
  assert.equal(r.min,              0);
  assert.equal(r.location,         "");
  assert.equal(r.lastPurchaseRate, 0);
});

test("mapRow — null / undefined / non-object input is safe", () => {
  assert.equal(mapRow(null).name,      "");
  assert.equal(mapRow(undefined).name, "");
  assert.equal(mapRow("not an object").name, "");
});

// ── parseRows — blank Name skipped ──────────────────────────────────────────

test("parseRows — blank Name is skipped silently (whitespace, empty, missing)", () => {
  const out = parseRows([
    { "Name": "Good Item",  "HSN Code": "111" },
    { "Name": "",           "HSN Code": "222" },   // blank → skip
    { "Name": "   ",        "HSN Code": "333" },   // whitespace → skip
    { "HSN Code": "444" },                          // missing Name → skip
    { "Name": "Another Item" },
  ], {});
  assert.equal(out.length, 2);
  assert.equal(out[0].name, "Good Item");
  assert.equal(out[1].name, "Another Item");
});

// ── parseRows — duplicate detection: by Code first, by Name fallback ────────

test("parseRows — match by HSN Code (existing.code === row.code)", () => {
  const existing = { Mechanical: [{ name: "Existing Bearing", code: "84821011", category: "Mechanical" }] };
  // Name is different on purpose — code match must win
  const out = parseRows([{ "Name": "Renamed In Sheet", "HSN Code": "84821011" }], existing);
  assert.equal(out.length, 1);
  assert.equal(out[0]._status, "update");
  assert.equal(out[0]._existingCode, "84821011");
  assert.equal(out[0]._matchedBy, "code");
});

test("parseRows — Name fallback when row has no HSN Code", () => {
  const existing = { Mechanical: [{ name: "Spindle Bearing 6205 ZZ", code: "OLD-001", category: "Mechanical" }] };
  const out = parseRows([{ "Name": "SPINDLE BEARING 6205 ZZ" }], existing);   // case-insensitive
  assert.equal(out.length, 1);
  assert.equal(out[0]._status, "update");
  assert.equal(out[0]._matchedBy, "name");
});

test("parseRows — new items (no match by code OR name) marked 'ready'", () => {
  const existing = { Mechanical: [{ name: "Existing", code: "EX-1" }] };
  const out = parseRows([{ "Name": "Brand New", "HSN Code": "999" }], existing);
  assert.equal(out.length, 1);
  assert.equal(out[0]._status, "ready");
});

test("parseRows — accepts BOTH grouped object AND flat array for existingItems", () => {
  const grouped = parseRows([{ "Name": "X", "HSN Code": "1" }], { Cat: [{ name: "X", code: "1" }] });
  assert.equal(grouped[0]._status, "update");
  const flat    = parseRows([{ "Name": "X", "HSN Code": "1" }], [{ name: "X", code: "1" }]);
  assert.equal(flat[0]._status, "update");
});

test("parseRows — handles null / undefined / empty inputs safely", () => {
  assert.deepEqual(parseRows(null, {}), []);
  assert.deepEqual(parseRows([], null), []);
  assert.deepEqual(parseRows(undefined, undefined), []);
});

// ── parseRows — bad row isolation ───────────────────────────────────────────

test("parseRows — one bad row does not break the batch", () => {
  const out = parseRows([
    { "Name": "Good 1", "HSN Code": "111" },
    null,                                            // bad row
    undefined,                                       // bad row
    "garbage",                                       // bad row
    { "Name": "Good 2", "HSN Code": "222" },
  ], {});
  assert.equal(out.length, 2);
  assert.equal(out[0].name, "Good 1");
  assert.equal(out[1].name, "Good 2");
});

// ── Re-import idempotency ───────────────────────────────────────────────────

test("re-import same sheet → second pass marks every row as 'update'", () => {
  const sheet = [
    { "Name": "Item A", "HSN Code": "111" },
    { "Name": "Item B", "HSN Code": "222" },
    { "Name": "Item C" },                            // no HSN — relies on name fallback
  ];

  // First pass: empty state → everything is "ready"
  const firstPass = parseRows(sheet, {});
  assert.equal(firstPass.length, 3);
  assert.ok(firstPass.every((r) => r._status === "ready"));

  // Simulate App applying the first pass to state. Item C has no code — App
  // auto-generates one. The auto-gen must NOT prevent the name fallback from
  // matching on the second pass.
  const appState = {
    Mechanical: firstPass.map((r, i) => ({
      name:     r.name,
      code:     r.code || `AUTOGEN-${i}`,
      category: "Mechanical",
    })),
  };

  // Second pass: every row should now be "update"
  const secondPass = parseRows(sheet, appState);
  assert.equal(secondPass.length, 3);
  assert.ok(secondPass.every((r) => r._status === "update"),
    `expected all 3 to be 'update', got: ${JSON.stringify(secondPass.map((r) => r._status))}`);

  // Match-by mode: A & B match by code, C matches by name
  assert.equal(secondPass[0]._matchedBy, "code");
  assert.equal(secondPass[1]._matchedBy, "code");
  assert.equal(secondPass[2]._matchedBy, "name");
});

test("re-import — adding a NEW row alongside existing rows works correctly", () => {
  const firstSheet = [
    { "Name": "Item A", "HSN Code": "111" },
  ];
  const state = { Mechanical: [{ name: "Item A", code: "111", category: "Mechanical" }] };
  const secondSheet = [
    { "Name": "Item A", "HSN Code": "111" },          // existing → update
    { "Name": "Item B", "HSN Code": "222" },          // new      → ready
  ];
  const out = parseRows(secondSheet, state);
  assert.equal(out.length, 2);
  assert.equal(out[0]._status, "update");
  assert.equal(out[1]._status, "ready");
});

// ── generateItemCode ────────────────────────────────────────────────────────

test("generateItemCode — uppercase slug + 4-digit suffix", () => {
  const c = generateItemCode("Hydraulic Oil ISO 46");
  assert.match(c, /^HYDRAULICOIL-\d{4}$/);
});

test("generateItemCode — fallback when name has no alphanumerics", () => {
  const c = generateItemCode("!@#$%");
  assert.match(c, /^ITEM-[A-Z0-9]+$/);
});

// ── ITEM_IMPORT_DEFAULTS sanity ─────────────────────────────────────────────

test("ITEM_IMPORT_DEFAULTS — frozen and exposes every spec field", () => {
  assert.ok(Object.isFrozen(ITEM_IMPORT_DEFAULTS));
  assert.equal(ITEM_IMPORT_DEFAULTS.stock,            0);
  assert.equal(ITEM_IMPORT_DEFAULTS.min,              0);
  assert.equal(ITEM_IMPORT_DEFAULTS.unit,             "Nos");
  assert.equal(ITEM_IMPORT_DEFAULTS.category,         "Mechanical");
  assert.equal(ITEM_IMPORT_DEFAULTS.location,         "");
  assert.deepEqual(ITEM_IMPORT_DEFAULTS.vendorLinks,  []);
  assert.equal(ITEM_IMPORT_DEFAULTS.lastPurchaseRate, 0);
  assert.equal(ITEM_IMPORT_DEFAULTS.photo,            null);
  assert.equal(ITEM_IMPORT_DEFAULTS.designFile,       null);
  assert.equal(ITEM_IMPORT_DEFAULTS.designName,       null);
});

// ── End-to-end: operator's exact sheet shape ────────────────────────────────

test("operator's mixed sheet (Name + HSN), blank rows skipped, no duplicates", () => {
  const sheet = [
    { "Name": "Bearing 6205",     "HSN Code": "84821011" },
    { "Name": "V-Belt B-42",      "HSN Code": "40103990" },
    { "Name": "",                 "HSN Code": "XXXX"     },   // skip (no name)
    { "Name": "Hydraulic Oil 46", "HSN Code": 27101981   },   // numeric HSN
    { "Name": "Generic Part" },                                // no HSN
  ];
  const out = parseRows(sheet, {});
  assert.equal(out.length, 4);
  assert.equal(out[0].name, "Bearing 6205");
  assert.equal(out[0].code, "84821011");
  assert.equal(out[2].code, "27101981");   // number → string
  assert.equal(out[3].code, "");            // blank HSN — App will auto-gen
  // Defaults applied uniformly
  for (const r of out) {
    assert.equal(r.unit,             "Nos");
    assert.equal(r.category,         "Mechanical");
    assert.equal(r.stock,            0);
    assert.equal(r.min,              0);
    assert.equal(r.lastPurchaseRate, 0);
    assert.equal(r.photo,            null);
    assert.equal(r.designFile,       null);
  }
});
