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
const { validateChecklistAnswers, checklistProblemText, incompleteChecklistJobs } = await import("../src/utils/checklistLogic.js");

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

test("an unticked checklist item may continue with a reason, and becomes a pending job", () => {
  const answers = [
    { id: "a", label: "Torque bolts", required: true,  checked: false, remark: "torque wrench at calibration" },
    { id: "b", label: "Oil",          required: false, checked: true },
  ];
  const chk = validateChecklistAnswers(answers);
  assert.equal(chk.ok, true, "a reason is enough to continue");
  assert.deepEqual(chk.requiredMissing, [0]);
  const jobs = incompleteChecklistJobs(answers, "Before Transfer");
  assert.equal(jobs.length, 1);
  assert.match(jobs[0].description, /Checklist not completed \(Before Transfer\): Torque bolts · Must do/);
  assert.equal(jobs[0].reason, "torque wrench at calibration");
  const noReason = validateChecklistAnswers([{ id: "a", required: true, checked: false, remark: "" }]);
  assert.equal(noReason.ok, false, "the reason is mandatory");
  assert.match(checklistProblemText(noReason), /reason/);
});

test("checklist jobs are raised on both Finish & Transfer and Accept", () => {
  assert.match(app, /incompleteChecklistJobs\(checklistAnswers, "Before Transfer"\)/);
  assert.match(app, /incompleteChecklistJobs\(checklistAnswers, "After Acceptance"\)/);
});

test("Acting Main Employee: admin only, must be the signing Main Employee, audited", () => {
  assert.match(app, /actingMainEmployeeId !== mainEmployeeId\) return \{ success: false/);
  assert.match(app, /Only an admin can assign an Acting Main Employee/);
  assert.match(app, /type: "acting_main_assigned"/);
});

test("READY is final and reached only through Trial", () => {
  assert.match(app, /READY needs the Trial Certificate — finish Trial first/);
  assert.match(app, /READY can only be accepted from Trial/);
  assert.match(app, /READY is the final stage and cannot be changed/);
  assert.match(app, /a finished machine cannot go back to the rack/);
  assert.match(app, /MACHINE_STAGES\.filter\(\(s, i\) => i > curIdx && s !== "Ready"\)/);
});

test("every path to Ready asks the pending-jobs gate", () => {
  // Finish & Transfer (Trial → Ready), Accept into Ready, admin stage change.
  const n = (app.match(/readyBlockedError\(/g) || []).length;
  // Finish & Transfer to Ready and Accept into Ready; the admin stage change
  // can no longer set Ready at all (see the READY test below).
  assert.ok(n >= 2, `expected the gate on both Ready paths, found ${n} calls`);
  assert.match(app, /if \(toDepartment === "Ready"\) \{[\s\S]{0,400}?const blocked = readyBlockedError\(machineId\)/);
  assert.match(app, /handover\.toDepartment === "Ready"\) \{[\s\S]{0,300}?const blocked = readyBlockedError\(handover\.machineId\)/);
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
