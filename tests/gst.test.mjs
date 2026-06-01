// Node tests for src/utils/gst.js — covers the Purchase Type catalogue, the
// Busy-style search filter, and the auto CGST/SGST/IGST split for the full
// matrix of cases.
//
// Run:  node --test tests/gst.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PURCHASE_TYPES, PURCHASE_TYPE_BY_KEY, ITEM_GST_RATES,
  DEFAULT_PURCHASE_TYPE_KEY,
  getPurchaseType, filterPurchaseTypes, calculateGSTBreakdown, todayIso,
} from "../src/utils/gst.js";

// ── Catalogue ──────────────────────────────────────────────────────────────

test("PURCHASE_TYPES — 19 options across Local / Interstate / Other", () => {
  assert.equal(PURCHASE_TYPES.length, 19);
  const local      = PURCHASE_TYPES.filter((t) => t.group === "Local");
  const interstate = PURCHASE_TYPES.filter((t) => t.group === "Interstate");
  const other      = PURCHASE_TYPES.filter((t) => t.group === "Other");
  assert.equal(local.length,      8);
  assert.equal(interstate.length, 8);
  assert.equal(other.length,      3);
});

test("PURCHASE_TYPES — every entry has key, label, gstType, group", () => {
  for (const t of PURCHASE_TYPES) {
    assert.ok(t.key,     `missing key on ${JSON.stringify(t)}`);
    assert.ok(t.label,   `missing label on ${t.key}`);
    assert.ok(t.gstType, `missing gstType on ${t.key}`);
    assert.ok(t.group,   `missing group on ${t.key}`);
  }
});

test("PURCHASE_TYPE_BY_KEY — O(1) lookup", () => {
  assert.equal(PURCHASE_TYPE_BY_KEY["local_gst_18"].label, "Local GST 18%");
  assert.equal(PURCHASE_TYPE_BY_KEY["inter_gst_5"].label,  "Interstate GST 5%");
  assert.equal(PURCHASE_TYPE_BY_KEY["import_purchase"].label, "Import Purchase");
});

test("ITEM_GST_RATES — 0, 5, 12, 18, 28 (Indian standard slabs)", () => {
  assert.deepEqual(ITEM_GST_RATES, [0, 5, 12, 18, 28]);
});

test("DEFAULT_PURCHASE_TYPE_KEY — most common is Local 18%", () => {
  assert.equal(DEFAULT_PURCHASE_TYPE_KEY, "local_gst_18");
});

// ── getPurchaseType ────────────────────────────────────────────────────────

test("getPurchaseType — by key", () => {
  assert.equal(getPurchaseType("local_gst_18").rate, 18);
});

test("getPurchaseType — by label (case-insensitive)", () => {
  assert.equal(getPurchaseType("Local GST 18%").key, "local_gst_18");
  assert.equal(getPurchaseType("local gst 18%").key, "local_gst_18");
});

test("getPurchaseType — null / unknown returns null", () => {
  assert.equal(getPurchaseType(""), null);
  assert.equal(getPurchaseType(null), null);
  assert.equal(getPurchaseType("not a type"), null);
});

// ── filterPurchaseTypes (Busy-style search) ────────────────────────────────

test("filterPurchaseTypes — empty query returns all", () => {
  assert.equal(filterPurchaseTypes("").length, 19);
});

test("filterPurchaseTypes — 'L' matches every Local row first (tier 1)", () => {
  const out = filterPurchaseTypes("L");
  // First 8 should all be Local (label starts with "Local")
  assert.ok(out.slice(0, 8).every((t) => t.group === "Local"));
});

test("filterPurchaseTypes — 'I' matches Interstate + Import + Item-wise variants", () => {
  const out = filterPurchaseTypes("I");
  // First results must start with "I"
  assert.ok(out[0].label.toLowerCase().startsWith("i"));
  // Interstate variants should appear (label starts with "I")
  const labels = out.map((t) => t.label);
  assert.ok(labels.includes("Interstate GST 18%"));
  assert.ok(labels.includes("Import Purchase"));
});

test("filterPurchaseTypes — 'IMP' lands on Import Purchase as top hit", () => {
  const out = filterPurchaseTypes("IMP");
  assert.ok(out.length >= 1);
  assert.equal(out[0].label, "Import Purchase");
});

test("filterPurchaseTypes — case-insensitive", () => {
  const lower = filterPurchaseTypes("local");
  const upper = filterPurchaseTypes("LOCAL");
  assert.deepEqual(lower.map((t) => t.key), upper.map((t) => t.key));
});

test("filterPurchaseTypes — substring match (tier 2): 'gst 18' finds both 18% rows", () => {
  const out = filterPurchaseTypes("gst 18");
  assert.ok(out.some((t) => t.key === "local_gst_18"));
  assert.ok(out.some((t) => t.key === "inter_gst_18"));
});

test("filterPurchaseTypes — no false positives ('zzz' returns empty)", () => {
  assert.deepEqual(filterPurchaseTypes("zzz"), []);
});

// ── calculateGSTBreakdown — local (CGST + SGST split) ──────────────────────

test("GST calc — Local 18% on ₹1000 → CGST 90 + SGST 90 = 180", () => {
  const b = calculateGSTBreakdown(1000, "local_gst_18");
  assert.equal(b.cgst, 90);
  assert.equal(b.sgst, 90);
  assert.equal(b.igst, 0);
  assert.equal(b.gst,  180);
  assert.equal(b.total, 1180);
});

test("GST calc — Local 5% on ₹1000 → CGST 25 + SGST 25 = 50", () => {
  const b = calculateGSTBreakdown(1000, "local_gst_5");
  assert.equal(b.cgst, 25);
  assert.equal(b.sgst, 25);
  assert.equal(b.gst,  50);
  assert.equal(b.total, 1050);
});

test("GST calc — Local 28% on ₹1000 → CGST 140 + SGST 140 = 280", () => {
  const b = calculateGSTBreakdown(1000, "local_gst_28");
  assert.equal(b.cgst, 140);
  assert.equal(b.sgst, 140);
  assert.equal(b.gst,  280);
  assert.equal(b.total, 1280);
});

// ── calculateGSTBreakdown — interstate (IGST single line) ──────────────────

test("GST calc — Interstate 18% on ₹1000 → IGST 180, no CGST/SGST", () => {
  const b = calculateGSTBreakdown(1000, "inter_gst_18");
  assert.equal(b.cgst, 0);
  assert.equal(b.sgst, 0);
  assert.equal(b.igst, 180);
  assert.equal(b.gst,  180);
  assert.equal(b.total, 1180);
});

test("GST calc — Interstate 12% on ₹2500 → IGST 300", () => {
  const b = calculateGSTBreakdown(2500, "inter_gst_12");
  assert.equal(b.igst, 300);
  assert.equal(b.total, 2800);
});

// ── calculateGSTBreakdown — exempt / nil / zero ────────────────────────────

test("GST calc — Local Exempt → all zero", () => {
  const b = calculateGSTBreakdown(1000, "local_gst_exempt");
  assert.equal(b.cgst, 0);
  assert.equal(b.sgst, 0);
  assert.equal(b.igst, 0);
  assert.equal(b.gst,  0);
  assert.equal(b.total, 1000);
  assert.equal(b.isExempt, true);
});

test("GST calc — Local Nil Rated → all zero", () => {
  const b = calculateGSTBreakdown(1000, "local_gst_nil");
  assert.equal(b.gst, 0);
  assert.equal(b.total, 1000);
});

test("GST calc — Zero Rated → all zero", () => {
  const b = calculateGSTBreakdown(1000, "zero_rated");
  assert.equal(b.gst, 0);
  assert.equal(b.total, 1000);
});

test("GST calc — Exempt Purchase → all zero", () => {
  const b = calculateGSTBreakdown(1000, "exempt_purchase");
  assert.equal(b.gst, 0);
  assert.equal(b.total, 1000);
});

// ── calculateGSTBreakdown — multi-rate / itemwise ──────────────────────────

test("GST calc — Local Multi Rate sums per-line gstRate", () => {
  const lines = [
    { amount: 1000, gstRate: 18 },        // 180 GST
    { amount:  500, gstRate: 12 },        //  60 GST
    { amount: 2000, gstRate: 28 },        // 560 GST
  ];
  const b = calculateGSTBreakdown(3500, "local_gst_multi", lines);
  // Total tax = 180 + 60 + 560 = 800. Split half-half for local.
  assert.equal(b.cgst, 400);
  assert.equal(b.sgst, 400);
  assert.equal(b.igst, 0);
  assert.equal(b.gst,  800);
  assert.equal(b.total, 4300);
});

test("GST calc — Interstate Item Wise sums into IGST", () => {
  const lines = [
    { amount: 1000, gstRate: 18 },        // 180
    { amount:  500, gstRate:  5 },        //  25
  ];
  const b = calculateGSTBreakdown(1500, "inter_gst_itemwise", lines);
  assert.equal(b.cgst, 0);
  assert.equal(b.igst, 205);
  assert.equal(b.total, 1705);
});

test("GST calc — Import Purchase routes through IGST too", () => {
  const lines = [
    { amount: 1000, gstRate: 28 },
  ];
  const b = calculateGSTBreakdown(1000, "import_purchase", lines);
  assert.equal(b.igst, 280);
  assert.equal(b.cgst, 0);
});

test("GST calc — Multi Rate with empty lines → 0 tax", () => {
  const b = calculateGSTBreakdown(1000, "local_gst_multi", []);
  assert.equal(b.gst, 0);
  assert.equal(b.total, 1000);
});

test("GST calc — Multi Rate falls back to 0 when line missing gstRate", () => {
  const lines = [{ amount: 1000 }];                  // no gstRate
  const b = calculateGSTBreakdown(1000, "local_gst_multi", lines);
  assert.equal(b.gst, 0);
});

test("GST calc — Multi Rate accepts gst_rate (snake) and gstRate (camel)", () => {
  const camel = calculateGSTBreakdown(1000, "local_gst_multi", [{ amount: 1000, gstRate:  18 }]);
  const snake = calculateGSTBreakdown(1000, "local_gst_multi", [{ amount: 1000, gst_rate: 18 }]);
  assert.equal(camel.gst, snake.gst);
});

// ── Rounding / numeric safety ──────────────────────────────────────────────

test("GST calc — odd local rate rounds without 0.01 drift", () => {
  // ₹333 * 18% = ₹59.94 → cgst 29.97, sgst 29.97 (sum exactly 59.94)
  const b = calculateGSTBreakdown(333, "local_gst_18");
  assert.equal(b.cgst + b.sgst, b.gst);
  assert.equal(Math.round(b.gst * 100), 5994);
});

test("GST calc — unknown purchase type returns zero tax (safe default)", () => {
  const b = calculateGSTBreakdown(1000, "nonexistent");
  assert.equal(b.gst, 0);
  assert.equal(b.total, 1000);
});

test("GST calc — handles non-numeric subtotal safely", () => {
  const b = calculateGSTBreakdown("not-a-number", "local_gst_18");
  assert.equal(b.subtotal, 0);
  assert.equal(b.total, 0);
});

// ── todayIso ───────────────────────────────────────────────────────────────

test("todayIso — yyyy-mm-dd shape", () => {
  assert.match(todayIso(), /^\d{4}-\d{2}-\d{2}$/);
});
