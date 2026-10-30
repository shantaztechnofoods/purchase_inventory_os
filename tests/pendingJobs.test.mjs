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
  // 2026-10-31 — the rule moved to utils/rackSlots.js with the slot logic; the
  // app must import it from there rather than carry its own copy.
  const rackSlots = fs.readFileSync(path.join(root, "src/utils/rackSlots.js"), "utf8");
  assert.match(rackSlots, /export function rackCapacityFor\(bomKey, _def, layout = PHYSICAL_RACK_LAYOUT\) \{\s*const slots = physicalRackSlots\(bomKey, layout\);\s*return slots != null \? slots : 0;/);
  assert.match(app, /import \{[^}]*rackCapacityFor[^}]*\} from "\.\/utils\/rackSlots\.js"/);
  assert.doesNotMatch(app, /\nfunction rackCapacityFor\(/);
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

// Migration 042 — the database guard on pending-job updates, and the app's two
// update payloads staying inside what it allows.
const mig042  = fs.readFileSync(path.join(root, "supabase/migrations/042_pending_item_update_guard.sql"), "utf8");
const rb042   = fs.readFileSync(path.join(root, "supabase/migrations/042_pending_item_update_guard_rollback.sql"), "utf8");
const storeSrc = fs.readFileSync(path.join(root, "src/stores/pendingItemsStore.js"), "utf8");

test("042: guard trigger rules are in the migration, with a rollback", () => {
  assert.match(mig042, /CREATE TRIGGER pending_handover_items_guard\s+BEFORE UPDATE OR DELETE ON public\.pending_handover_items/);
  assert.match(mig042, /IF OLD\.received_at IS NOT NULL THEN\s+RAISE EXCEPTION/);          // receive once
  assert.match(mig042, /receive_keys\s+text\[\] := ARRAY\['received_at','received_by','received_notes'\]/);
  assert.match(mig042, /complete_keys text\[\] := ARRAY\['status','resolved_at','resolved_by','resolved_in_department','resolution_notes'\]/);
  assert.match(mig042, /IF OLD\.status = 'resolved' THEN\s+RAISE EXCEPTION/);               // no reopen / edit
  assert.match(mig042, /IF TG_OP = 'DELETE' THEN\s+RAISE EXCEPTION/);                       // no delete
  assert.doesNotMatch(mig042, /DROP POLICY|ALTER TABLE|CREATE POLICY/, "042 must not touch policies or columns");
  assert.match(rb042, /DROP TRIGGER IF EXISTS pending_handover_items_guard/);
  assert.match(rb042, /DROP FUNCTION IF EXISTS public\.pending_handover_items_guard\(\)/);
});

test("042: the app only ever sends the fields the guard allows", () => {
  const bodies = [
    ...[...storeSrc.matchAll(/\.from\("pending_handover_items"\)\.update\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]),
    ...[...storeSrc.matchAll(/const body = \{([\s\S]*?)\};/g)].map((m) => m[1]),
  ];
  assert.equal(bodies.length, 2, "exactly two update paths: complete and receive");
  const keysOf = (b) => [...b.matchAll(/^\s*([a-z_]+)\s*:/gm)].map((m) => m[1]).sort();
  const allowedComplete = ["resolution_notes", "resolved_at", "resolved_by", "resolved_in_department", "status"];
  const allowedReceive  = ["received_at", "received_by", "received_in_department", "received_notes"];
  for (const b of bodies) {
    const k = keysOf(b);
    const ok = JSON.stringify(k) === JSON.stringify(allowedComplete) || JSON.stringify(k) === JSON.stringify(allowedReceive);
    assert.ok(ok, `unexpected update payload keys: ${k.join(", ")}`);
  }
});

const mig043 = fs.readFileSync(path.join(root, "supabase/migrations/043_pending_item_receive_department.sql"), "utf8");
const rb043  = fs.readFileSync(path.join(root, "supabase/migrations/043_pending_item_receive_department_rollback.sql"), "utf8");

test("043: receive department column; guard keeps every 042 rule and allows it on receive only", () => {
  assert.match(mig043, /ADD COLUMN IF NOT EXISTS received_in_department text/);
  assert.match(mig043, /receive_keys\s+text\[\] := ARRAY\['received_at','received_by','received_notes','received_in_department'\]/);
  assert.match(mig043, /complete_keys text\[\] := ARRAY\['status','resolved_at','resolved_by','resolved_in_department','resolution_notes'\]/);
  assert.match(mig043, /IF OLD\.received_at IS NOT NULL THEN\s+RAISE EXCEPTION/);
  assert.match(mig043, /IF OLD\.status = 'resolved' THEN\s+RAISE EXCEPTION/);
  assert.match(mig043, /IF TG_OP = 'DELETE' THEN\s+RAISE EXCEPTION/);
  assert.doesNotMatch(mig043, /POLICY/, "043 must not touch policies");
  assert.match(rb043, /receive_keys\s+text\[\] := ARRAY\['received_at','received_by','received_notes'\]/);
  assert.match(rb043, /DROP COLUMN IF EXISTS received_in_department/);
});

test("reason history: three separate entries, earlier ones never replaced", async () => {
  const { pendingItemHistory } = await import("../src/stores/pendingItemsStore.js");
  const job = { raisedAt: "2026-10-30T09:00:00Z", raisedBy: "u1", raisedInDepartment: "Assembly", reason: "Cover damaged, on order",
                description: "Fit the cover", status: "open" };
  assert.deepEqual(pendingItemHistory(job).map((e) => e.kind), ["reported"]);
  const received = { ...job, receivedAt: "2026-10-31T10:00:00Z", receivedBy: "u2", receivedInDepartment: "Stores", receivedNotes: "Replacement received" };
  const h2 = pendingItemHistory(received);
  assert.deepEqual(h2.map((e) => e.kind), ["reported", "received"]);
  assert.equal(h2[0].text, "Cover damaged, on order", "original reason unchanged");
  assert.equal(h2[1].text, "Replacement received");
  assert.equal(h2[1].department, "Stores");
  const done = { ...received, status: "resolved", resolvedAt: "2026-10-31T12:00:00Z", resolvedBy: "u3", resolvedInDepartment: "Assembly", resolutionNotes: "Fitted" };
  const h3 = pendingItemHistory(done);
  assert.deepEqual(h3.map((e) => [e.kind, e.text, e.by, e.department]), [
    ["reported", "Cover damaged, on order", "u1", "Assembly"],
    ["received", "Replacement received", "u2", "Stores"],
    ["completed", "Fitted", "u3", "Assembly"],
  ]);
});

test("reason history is shown in Pending Jobs, machine card, Production report and A-to-Z report", () => {
  const uses = (app.match(/<JobHistory item=\{p\}/g) || []).length;
  assert.ok(uses >= 5, `expected JobHistory in 5 places, found ${uses}`);
  assert.match(app, /<PendingJobsHistory \/>/);
  assert.match(app, /ReportedReason: p\.reason/);
  assert.match(app, /ReceiveRemark: p\.receivedNotes/);
});
