import { test } from "node:test";
import assert from "node:assert/strict";
import { receivedPoRates, resolveItemRate, bomCostLines, bomCostSummary, validateBomLines, formatINR } from "../src/utils/bomCost.js";

const inv = {
  "MTR-1HP": { code: "MTR-1HP", name: "Motor", unit: "Nos", lastPurchaseRate: 4200 },
  "GBX-R20": { code: "GBX-R20", name: "Gearbox", unit: "Nos", lastPurchaseRate: 0, defaultPurchaseRate: 1800 },
  "BRG-6205": { code: "BRG-6205", name: "Bearing", unit: "Pcs" },
  "SHF-25": { code: "SHF-25", name: "Shaft", unit: "Pcs" },
};
const find = (c) => inv[c];
const pos = [
  { id: "PO-1", status: "received", receivedDate: "2026-05-01", lineItems: [{ code: "BRG-6205", rate: 150 }] },
  { id: "PO-2", status: "received", receivedDate: "2026-06-01", lineItems: [{ code: "BRG-6205", rate: 160 }, { code: "SHF-25", rate: 0 }] },
  { id: "PO-3", status: "pending",  date: "2026-07-01", lineItems: [{ code: "SHF-25", rate: 999 }] },
];

test("receivedPoRates: newest received PO wins, zero and unreceived ignored", () => {
  const r = receivedPoRates(pos);
  assert.equal(r["BRG-6205"].rate, 160);
  assert.equal(r["BRG-6205"].poId, "PO-2");
  assert.equal(r["SHF-25"], undefined);
});

test("resolveItemRate priority: last purchase → default → received PO → missing", () => {
  const pr = receivedPoRates(pos);
  assert.deepEqual(resolveItemRate(inv["MTR-1HP"], pr), { rate: 4200, source: "last_purchase" });
  assert.deepEqual(resolveItemRate(inv["GBX-R20"], pr), { rate: 1800, source: "default" });
  assert.equal(resolveItemRate(inv["BRG-6205"], pr).source, "received_po");
  assert.equal(resolveItemRate(inv["SHF-25"], pr).rate, null);
});

test("bomCostLines + summary: amounts, missing rate, orphan, duplicate, zero qty, units", () => {
  const lines = [
    { code: "MTR-1HP", qty: 1 }, { code: "GBX-R20", qty: 2 }, { code: "BRG-6205", qty: 2 },
    { code: "SHF-25", qty: 1 }, { code: "NOPE-1", qty: 1 }, { code: "MTR-1HP", qty: 0 },
  ];
  const cl = bomCostLines(lines, find, receivedPoRates(pos), 2);
  assert.equal(cl[0].amount, 8400);          // 4200 × 1 × 2 units
  assert.equal(cl[1].amount, 7200);          // 1800 × 2 × 2
  assert.equal(cl[2].amount, 640);           // 160 × 2 × 2
  assert.equal(cl[3].status, "missing_rate");
  assert.equal(cl[4].status, "missing_item");
  assert.equal(cl[5].status, "zero_qty");
  assert.equal(cl[0].duplicate, true);
  const s = bomCostSummary(cl);
  assert.equal(s.knownTotal, 16240);
  assert.equal(s.missingRate, 1);
  assert.equal(s.missingItem, 1);
  assert.equal(s.zeroQty, 1);
  assert.deepEqual(s.duplicates, ["MTR-1HP"]);
  assert.equal(s.complete, false);
});

test("summary is complete only when every line has item, qty and rate", () => {
  const cl = bomCostLines([{ code: "MTR-1HP", qty: 1 }, { code: "GBX-R20", qty: 1 }], find, {}, 1);
  const s = bomCostSummary(cl);
  assert.equal(s.complete, true);
  assert.equal(s.knownTotal, 6000);
});

test("validateBomLines blocks duplicates / zero qty, warns on unknown code", () => {
  const v = validateBomLines([{ code: "MTR-1HP", qty: 1 }, { code: "MTR-1HP", qty: 1 }, { code: "X", qty: 0 }], find);
  assert.equal(v.ok, false);
  assert.equal(v.errors.length, 2);
  assert.equal(v.warnings.length, 1);
  assert.equal(validateBomLines([{ code: "MTR-1HP", qty: 1 }], find).ok, true);
});

test("formatINR", () => {
  assert.equal(formatINR(null), "—");
  assert.equal(formatINR(16240), "₹16,240");
});
