// Pending jobs (2026-10-30): the missing part on a job, the "part received"
// step, the Ready gate, BOM durations, fixed racks, and required checklist
// items. Runs the real store code down its localStorage branch (a tiny
// in-memory localStorage is installed below) so no network is needed.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};

const { createPendingItem, receivePendingItem, resolvePendingItem, fetchPendingItems, pendingItemStage } =
  await import("../src/stores/pendingItemsStore.js");
const { validateChecklistAnswers, checklistProblemText } = await import("../src/utils/checklistLogic.js");

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const app  = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");

test("a pending job records the missing part: code, name, qty, reason", async () => {
  const r = await createPendingItem({
    machineId: 1, raisedInDepartment: "Assembly", assignedDepartment: "Stores", raisedBy: "u1",
    description: "Gearbox cover not issued", kind: "owed",
    itemCode: "GB-COVER", itemName: "Gearbox cover", qty: 2, reason: "Not in store — on order",
  });
  assert.equal(r.success, true);
  assert.equal(r.item.itemCode, "GB-COVER");
  assert.equal(r.item.itemName, "Gearbox cover");
  assert.equal(r.item.qty, 2);
  assert.equal(r.item.reason, "Not in store — on order");
  assert.equal(r.item.kind, "owed");
  assert.equal(r.item.status, "open");
  assert.equal(pendingItemStage(r.item), "awaiting");
});

test("history: reported → awaiting → received → completed", async () => {
  const r = await createPendingItem({ machineId: 2, assignedDepartment: "Mechanical", raisedBy: "u1", description: "Fit the cover", itemCode: "GB-COVER", qty: 1 });
  const id = r.item.id;
  const rec = await receivePendingItem(id, { receivedBy: "u2", notes: "arrived from Stores" });
  assert.equal(rec.success, true);
  assert.ok(rec.item.receivedAt);
  assert.equal(rec.item.receivedNotes, "arrived from Stores");
  assert.equal(rec.item.status, "open", "receiving a part does not complete the job");
  assert.equal(pendingItemStage(rec.item), "received");
  // Receiving twice is refused on Supabase; locally it is a no-op on the row.
  const again = await receivePendingItem(id, { receivedBy: "u3", notes: "x" });
  assert.equal(again.item.receivedNotes, "arrived from Stores");
  const done = await resolvePendingItem(id, { resolvedBy: "u2", resolvedInDepartment: "Mechanical", notes: "fitted" });
  assert.equal(done.success, true);
  const all = await fetchPendingItems();
  const row = all.find((p) => p.id === id);
  assert.equal(row.status, "resolved");
  assert.equal(pendingItemStage(row), "completed");
  assert.ok(row.receivedAt, "the received step is kept after completion");
});

test("a required ('Must do') checklist item cannot be skipped with a remark", () => {
  const chk = validateChecklistAnswers([
    { id: "a", label: "Torque bolts", required: true,  checked: false, remark: "will do later" },
    { id: "b", label: "Oil",          required: false, checked: false, remark: "topped up by stores" },
  ]);
  assert.equal(chk.ok, false);
  assert.deepEqual(chk.requiredMissing, [0]);
  assert.deepEqual(chk.missing, []);
  assert.match(checklistProblemText(chk), /Must do/);
  const ok = validateChecklistAnswers([
    { id: "a", required: true, checked: true },
    { id: "b", required: false, checked: false, remark: "n/a" },
  ]);
  assert.equal(ok.ok, true);
});

test("every path to Ready asks the pending-jobs gate", () => {
  // Finish & Transfer (Trial → Ready), Accept into Ready, admin stage change.
  const n = (app.match(/readyBlockedError\(/g) || []).length;
  assert.ok(n >= 3, `expected the gate to be called on 3 paths, found ${n} calls`);
  assert.match(app, /toDepartment === "Ready"\) \{\s*const blocked = readyBlockedError\(machineId\)/);
  assert.match(app, /handover\.toDepartment === "Ready"\) \{\s*const blocked = readyBlockedError\(handover\.machineId\)/);
});

test("racks are the fixed floor racks only — no capacity from the BOM", () => {
  assert.match(app, /function rackCapacityFor\(bomKey, _def\) \{\s*const slots = physicalRackSlots\(bomKey\);\s*return slots != null \? slots : 0;/);
});

test("Outward skips the durations popup when the BOM carries all four", () => {
  assert.match(app, /if \(serialNo && !durationConfirmed && !bomDurationsSet\)/);
  assert.match(app, /const bomDurationsSet = bomHasAllDurations\(bom\)/);
});

test("critical items not issued at Outward are raised as pending jobs on the machine", () => {
  assert.match(app, /criticalInput && it\.criticalInput\.notIssued/);
  assert.match(app, /Part not issued at BOM Outward/);
  assert.match(app, /assignedDepartment: "Stores"/);
});
