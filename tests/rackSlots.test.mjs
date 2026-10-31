import { test } from "node:test";
import assert from "node:assert/strict";
import { rackViewLog, PHYSICAL_RACK_LAYOUT, rackOfBom, rackBoms, rackCapacityFor, familySlotIds, buildFamilyRacks, firstFreeSlot, canAssignSlot, slotLabel, slotStatusOf, pairSlotOf, setSlotOf, setLabel, bomFillCheck, rCrateIssues, freeSlotsFor } from "../src/utils/rackSlots.js";

const fam10 = PHYSICAL_RACK_LAYOUT.families[0];
const m = (id, over = {}) => ({ id, bomKey: "KM10", serialNo: `S${id}`, stage: "BOM Issued", status: "active", createdDate: `2026-10-${String(10 + id).padStart(2, "0")}`, ...over });

test("six fixed racks, two slots each, one BOM per rack", () => {
  const racks = PHYSICAL_RACK_LAYOUT.families.flatMap((f) => PHYSICAL_RACK_LAYOUT.tiers.map((t) => `${t}-${f.label}`));
  assert.deepEqual(racks, ["M-10", "R-10", "M-15", "R-15", "M-20", "R-20"]);
  for (const k of ["M-10", "R-10", "M-15", "R-15", "M-20", "R-20"]) assert.equal(rackCapacityFor(k), 2, k);
  assert.deepEqual(familySlotIds(fam10), ["M-10-1#1", "M-10-1#2", "R-10-1#1", "R-10-1#2"]);
  assert.equal(slotLabel("M-10-1#2"), "M-10 (2)");
  assert.equal(slotLabel("R-20-1#1"), "R-20 (1)");
});

test("rack ↔ BOM mapping is exact; every other BOM is Direct Production only", () => {
  const exp = { "M-10": ["10", "M"], "R-10": ["10", "R"], "M-15": ["15", "M"], "R-15": ["15", "R"], "M-20": ["20", "M"], "R-20": ["20", "R"] };
  for (const [k, [fam, tier]] of Object.entries(exp)) { const r = rackOfBom(k); assert.equal(r.family.label, fam, k); assert.equal(r.tier, tier, k); assert.equal(r.legacy, false); }
  for (const k of ["AM900", "ARM1800", "TM600", "VK", "PILOT-KM10", "TRIAL-01", "KM-10", "M10", "R 10", "NEW-RND-1"]) {
    assert.equal(rackOfBom(k), null, k); assert.equal(rackCapacityFor(k), 0, k);
  }
  // Retired keys keep their machines on the M rack (history), never the R rack.
  for (const [k, fam] of [["KM10", "10"], ["KM15", "15"], ["KM20", "20"]]) { const r = rackOfBom(k); assert.equal(r.tier, "M"); assert.equal(r.family.label, fam); assert.equal(r.legacy, true); }
  assert.deepEqual(rackBoms(fam10, "M"), { primary: "M-10", keys: ["M-10", "KM10"] });
  assert.deepEqual(rackBoms(fam10, "R"), { primary: "R-10", keys: ["R-10"] });
});

const mm = (id, bomKey, over = {}) => m(id, { bomKey, ...over });

test("a machine only ever lands on its own rack", () => {
  const log = [mm(1, "M-10"), mm(2, "R-10"), mm(3, "M-10"), mm(4, "M-10")];
  const { placed, overflow } = buildFamilyRacks(fam10, log);
  assert.equal(placed["M-10-1#1"].machine.id, 1);
  assert.equal(placed["M-10-1#2"].machine.id, 3);
  assert.equal(placed["R-10-1#1"].machine.id, 2);
  assert.equal(placed["R-10-1#2"], undefined, "an M-10 set never spills onto the R-10 rack");
  assert.deepEqual(overflow.map((x) => x.id), [4]);
  // A wrong-rack pin is ignored and the set re-flows onto its own rack.
  const p2 = buildFamilyRacks(fam10, [mm(5, "R-10", { rackSlot: "M-10-1#1" })]).placed;
  assert.equal(p2["M-10-1#1"], undefined); assert.equal(p2["R-10-1#1"].machine.id, 5);
});

test("legacy KM10 machine keeps its saved slot (live fcbf: M-10-1#2)", () => {
  const log = [mm(64, "KM10", { serialNo: "fcbf", rackSlot: "M-10-1#2" })];
  const { placed } = buildFamilyRacks(fam10, log);
  assert.equal(placed["M-10-1#2"].machine.serialNo, "fcbf");
  assert.equal(placed["M-10-1#2"].pinned, true);
  assert.equal(firstFreeSlot("M-10", log), "M-10-1#1");
});

test("slot status: set / assembling / assembled / empty; machine past Assembly is off the rack", () => {
  const awaiting = new Set(["5"]);
  const log = [mm(4, "M-10", { rackSlot: "M-10-1#1", stage: "Assembly" }), mm(5, "M-10", { rackSlot: "M-10-1#2", stage: "Assembly" }), mm(6, "R-10", { stage: "Mechanical", rackSlot: "R-10-1#1" })];
  const { columns, placed } = buildFamilyRacks(fam10, log, awaiting);
  assert.equal(columns[0][0].slots[0].status, "assembling");
  assert.equal(columns[0][0].slots[1].status, "assembled");
  assert.equal(columns[0][0].name, "M-10");
  assert.equal(columns[0][1].name, "R-10");
  assert.equal(placed["R-10-1#1"], undefined);
  assert.equal(slotStatusOf(null), "empty");
});

test("firstFreeSlot: preferred slot on own rack only; full rack → null; no rack → null", () => {
  const log = [mm(1, "M-10", { rackSlot: "M-10-1#1" })];
  assert.equal(firstFreeSlot("M-10", log), "M-10-1#2");
  assert.equal(firstFreeSlot("M-10", log, new Set(), "R-10-1#2"), "M-10-1#2", "an R slot is never preferred for an M BOM");
  assert.equal(firstFreeSlot("R-10", log, new Set(), "R-10-1#2"), "R-10-1#2");
  assert.equal(firstFreeSlot("AM900", log), null);
  const full = [mm(1, "M-10", { rackSlot: "M-10-1#1" }), mm(2, "M-10", { rackSlot: "M-10-1#2" })];
  assert.equal(firstFreeSlot("M-10", full), null);
  assert.equal(firstFreeSlot("R-10", full), "R-10-1#1");
});

test("M and R units are independent: own machine, own serial, nothing mirrored", () => {
  const log = [mm(1, "M-10", { serialNo: "M1", rackSlot: "M-10-1#1" }), mm(2, "R-10", { serialNo: "R9", rackSlot: "R-10-1#1" })];
  const { placed } = buildFamilyRacks(fam10, log);
  assert.equal(placed["M-10-1#1"].machine.serialNo, "M1");
  assert.equal(placed["R-10-1#1"].machine.serialNo, "R9");
  assert.equal(placed["R-10-1#2"], undefined, "an M machine never appears on an R unit");
  assert.equal(placed["M-10-1#2"], undefined);
  assert.deepEqual(freeSlotsFor("M-10", log), ["M-10-1#2"]);
  assert.deepEqual(freeSlotsFor("R-10", log), ["R-10-1#2"]);
  assert.deepEqual(freeSlotsFor("AM900", log), []);
  assert.equal(firstFreeSlot("R-10", log, new Set(), "R-10-1#2"), "R-10-1#2", "the rack the operator picked is used");
  assert.equal(firstFreeSlot("M-10", log, new Set(), "R-10-1#2"), "M-10-1#2", "an R unit is never used for an M BOM");
});

test("canAssignSlot: no double assignment, own model's sets only, only rack machines", () => {
  const log = [mm(1, "M-10", { rackSlot: "M-10-1#1" }), mm(2, "M-10"), mm(3, "M-15")];
  assert.equal(canAssignSlot(log[1], "M-10-1#1", log).ok, false);
  assert.equal(canAssignSlot(log[1], "R-10-1#1", log).ok, false, "the R unit of a taken set is taken too");
  assert.equal(canAssignSlot(log[1], "M-10-1#2", log).ok, true);
  assert.equal(canAssignSlot(log[2], "M-10-1#2", log).ok, false, "M-15 set cannot go on the M-10 / R-10 racks");
  assert.equal(canAssignSlot({ ...log[1], stage: "Mechanical" }, "M-10-1#2", log).ok, false);
  assert.equal(canAssignSlot(mm(9, "AM900"), "M-10-1#2", log).ok, false);
});

test("bomFillCheck: each rack checks its OWN BOM — missing, retired, empty, short, unknown, ok", () => {
  const inv = { A: { code: "A", stock: 5 }, B: { code: "B", stock: 1 } };
  const stockOf = (c) => inv[c];
  const defs = { "M-10": { items: [{ code: "A", qty: 2 }] }, "R-10": { items: [] }, "M-15": { items: [{ code: "B", qty: 2 }] }, "M-20": { items: [{ code: "ZZ", qty: 1 }] }, KM10: { items: [{ code: "A", qty: 1 }], retiredAt: "x" } };
  assert.equal(bomFillCheck("M-10", defs, stockOf).ok, true);
  const r10 = bomFillCheck("R-10", defs, stockOf); assert.equal(r10.ok, false); assert.equal(r10.empty, true); assert.match(r10.why, /R-10 BOM has no components/);
  assert.deepEqual(bomFillCheck("M-15", defs, stockOf).short.map((l) => l.code), ["B"]);
  assert.equal(bomFillCheck("M-20", defs, stockOf).ok, false, "a component not in the Item Master blocks the rack");
  assert.equal(bomFillCheck("KM10", defs, stockOf).ok, false, "a retired BOM is never filled");
  assert.equal(bomFillCheck("R-20", defs, stockOf).ok, false);
});

test("rCrateIssues: the R crate is a separate R BOM outward under the same serial", () => {
  const log = [
    { id: 1, type: "bom", ref: "M-10", serialNo: "S1" },
    { id: 2, type: "bom", ref: "R-10", serialNo: "s1" },
    { id: 3, type: "bom", ref: "R-10", serialNo: "S2" },
    { id: 4, type: "manual", ref: "R-10", serialNo: "S1" },
  ];
  assert.deepEqual(rCrateIssues(log, "R-10", "S1").map((e) => e.id), [2]);
  assert.deepEqual(rCrateIssues(log, "R-10", "S3"), []);
  assert.deepEqual(rCrateIssues(log, "R-10", ""), []);
});

test("rackViewLog: a released machine leaves its slot even if rack_slot was not cleared", () => {
  const log = [m(1, { stage: "Assembly", rackSlot: "M-10-1#1" }), m(2, { stage: "Assembly", rackSlot: "M-10-1#2" })];
  const hos = [{ machineId: 1, releaseRequired: true, releasedAt: "2026-10-31T01:00:00Z", status: "pending" },
               { machineId: 2, releaseRequired: true, releasedAt: null, status: "pending" }];
  const v = rackViewLog(log, hos);
  assert.equal(v[0].rackSlot, null);
  assert.equal(v[1].rackSlot, "M-10-1#2");
  const { placed } = buildFamilyRacks(fam10, v, new Set(["2"]));
  assert.equal(placed["M-10-1#1"], undefined);
  assert.equal(placed["M-10-1#2"].machine.id, 2);
  assert.equal(firstFreeSlot("KM10", v, new Set(["2"])), "M-10-1#1");
});

// 2026-10-31 hotfix guard: App.jsx once called physicalRackSlots() without
// importing it (ReferenceError in BOM Create / Edit). Every rackSlots export
// that App.jsx calls must be in its import list.
test("App.jsx imports every rackSlots helper it uses", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  const lib = fs.readFileSync(path.join(root, "src/utils/rackSlots.js"), "utf8");
  const exported = [...lib.matchAll(/export (?:function|const) (\w+)/g)].map((m) => m[1]);
  const imp = app.match(/import \{([^}]*)\} from "\.\/utils\/rackSlots\.js"/);
  assert.ok(imp, "App.jsx must import from utils/rackSlots.js");
  const imported = new Set(imp[1].split(",").map((x) => x.trim()));
  for (const name of exported) {
    const used = new RegExp(`\\b${name}\\b`).test(app.replace(imp[0], ""));
    const locallyDefined = new RegExp(`(function|const|let) ${name}\\b`).test(app);
    if (used && !locallyDefined) assert.ok(imported.has(name), `App.jsx uses ${name} but does not import it`);
  }
});

// 2026-10-31 fixed racks — App wiring guards.
test("App: retired BOMs are not issuable; Fill opens only the rack's own BOM; material gates", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.match(app, /const boms = Object\.entries\(bomDefs \|\| \{\}\)\.filter\(\(\[, b\]\) => !\(b && b\.retiredAt\)\)/);
  assert.match(app, /onFillRack\(sl\.id, rack\.bom\.primary\)/, "Fill passes the rack's own BOM");
  assert.match(app, /const chk = bomFillCheck\(bomKey, bomDefs, stockOf\);\n    if \(!chk\.ok\) return \{ success: false/, "Fill refuses unless that rack's BOM is complete and in stock");
  assert.match(app, /if \(serialNo && shortLines\.length > 0\)/, "no machine (rack or direct) while any component is short");
  assert.match(app, /no assembly while BOM components are still pending/);
  assert.match(app, /if \(bomOpenRequest\.n <= __lastFillRequestN\) return;/, "a Fill request opens the BOM once");
});

// 2026-10-31 M/R sets — guards for the approved rack fixes and the
// separate-BOM / shared-serial pairing.
test("App: independent M/R units, BOM Outward rack picker, remove, release scope and permissions", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.doesNotMatch(app, /mergeSetBomItems|setFillCheck/, "M and R BOMs are never merged");
  assert.match(app, /const drawerBom = bomDefs\[openBOM\];/, "the drawer always shows the rack's own BOM");
  // Fill Rack on any empty unit opens that rack's own BOM and fills that unit
  assert.match(app, /if \(tierOfSlot\(slotId\) !== r\.tier\) return \{ success: false/);
  assert.match(app, /setBomOpenRequest\(\{ key: bomKey, slotId, mode: "set", n: Date\.now\(\) \}\);/);
  assert.doesNotMatch(app, /mode: "crate", serialNo: holder\.serialNo/, "no serial is copied to the paired rack");
  // BOM Outward: the operator picks the exact empty rack; it is used for the machine
  assert.match(app, /data-slot-choice=\{id\} onClick=\{\(\) => doIssue\("rack", \{ durationConfirmed: true, slot: id \}\)\}/);
  assert.match(app, /if \(serialNo && rackTracked && !rackSet && !slot\) \{/);
  assert.match(app, /rackSlot: finalDest === "rack" \? \(rackSet \? rackSet\.slotId : slot\) : null/);
  assert.match(app, /const preferred = preferredSlot \|\| \(reserved/);
  // no popup when the rack was chosen in the Rack View
  assert.match(app, /if \(serialNo && !chosenDest && rackSet\) \{\n      \/\/ A set fill has one destination: the selected set\. No popup\.\n      return doIssue\("rack"/);
  // remove from rack returns only this machine's own BOM outwards
  assert.match(app, /rackKeyNorm\(e\.ref\) === rackKeyNorm\(machine\.bomKey\)\) : \[\];/);
  assert.match(app, /const handleRemoveRackMachine = async \(machineId\) => \{\n    if \(!authCanDo\("outward", "delete"\)\)/);
  assert.match(app, /Nothing was removed — the set is still on the rack\./);
  // release only for rack machines; permissions
  assert.match(app, /payload\.releaseRequired = !!machine\.rackSlot && RACK_RELEASE_HOPS\.some\(/);
  assert.match(app, /const handleStartProduction = \(machineIds\) => \{\n    if \(!authCanDo\("machines", "updateStage"\)\)/);
  assert.match(app, /if \(!canFinishTransfer\(authCanDo\)\) return \{ success: false/);
  // Not issued with a reason does not block a rack
  assert.match(app, /const rackIncomplete = \(\) => enriched\.filter\(\(i\) => !skippedCodes\.has\(i\.code\) && \(!isItemChecked\(i\.code\) \|\| !i\.inv \|\| i\.pendingQty > 0 \|\| i\.issueQty < i\.required\)\);/);
  assert.match(app, /BOM Ready · \{niN\} Pending/);
  assert.match(app, /const mv = await handleUpdateStock\(cat, p\.itemCode, -qty, ref\);/);
  assert.match(app, /data-pending-action="issue"/);
});

test("migration 047 guards one machine per set and M-slot pairing in the database", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const up = fs.readFileSync(path.join(root, "supabase/migrations/047_rack_set_guard.sql"), "utf8");
  const up48 = fs.readFileSync(path.join(root, "supabase/migrations/048_rack_set_serial_guard.sql"), "utf8");
  assert.match(up48, /already used by machine/);
  const up49 = fs.readFileSync(path.join(root, "supabase/migrations/049_rack_unit_guard.sql"), "utf8");
  assert.doesNotMatch(up49, /regexp_replace\([^)]*'\^R-', 'M-'\)/, "049: an R unit is not read as its M unit");
  assert.doesNotMatch(up49, /\b(DROP TABLE|TRUNCATE|DELETE FROM|ALTER POLICY|CREATE POLICY|DROP POLICY)\b/i);
  assert.doesNotMatch(up48, /\b(DROP TABLE|TRUNCATE|DELETE FROM|ALTER POLICY|CREATE POLICY|DROP POLICY)\b/i);
  const down = fs.readFileSync(path.join(root, "supabase/migrations/047_rack_set_guard_rollback.sql"), "utf8");
  assert.match(up, /pg_advisory_xact_lock/);
  assert.match(up, /CREATE TRIGGER machine_log_rack_set_guard/);
  assert.match(up, /machine_log_rack_slot_is_set/);
  assert.doesNotMatch(up, /\b(DROP TABLE|TRUNCATE|DELETE FROM|ALTER POLICY|CREATE POLICY|DROP POLICY)\b/i, "additive only, no RLS change");
  assert.match(down, /DROP TRIGGER IF EXISTS machine_log_rack_set_guard/);
});

// 2026-10-31 live bug (M-10, S/N asdf123): a critical item unticked in the list
// and marked Not verified with a reason was rejected as "unticked".
test("App: unticked critical item on a rack BOM is Not Issued once it has a reason", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.match(app, /const untickedCritical = rackBomForCheck\n    \? enriched\.filter\(\(i\) => !isItemChecked\(i\.code\) && i\.inv && i\.inv\.isCritical/);
  assert.match(app, /const criticalLines = \[\.\.\.checkedE\.filter\(\(i\) => i\.issueQty > 0 && i\.inv && i\.inv\.isCritical\), \.\.\.untickedCritical\];/);
  assert.match(app, /if \(!isItemChecked\(line\.code\)\) return false;   \/\/ unticked → never "verified"/);
  // only the explained unticked lines are recorded (as Not Issued); others are never issued
  assert.match(app, /\[\.\.\.checkedE, \.\.\.untickedCritical\.filter\(\(l\) => skippedCodes\.has\(l\.code\)\)\]\.forEach\(\(item\) => \{/);
  // rack check still blocks unticked / short / unknown lines that are not explained
  assert.match(app, /const rackIncomplete = \(\) => enriched\.filter\(\(i\) => !skippedCodes\.has\(i\.code\) && \(!isItemChecked\(i\.code\) \|\| !i\.inv \|\| i\.pendingQty > 0 \|\| i\.issueQty < i\.required\)\);/);
});

// 2026-10-31 — Assembly returns the machine to its rack; an Admin transfers it
// to Mechanical from the Rack View (no Production Manager login yet).
test("App: finish Assembly returns a rack machine to its rack; admin transfers from Rack View", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.match(app, /const rackReturn = !!machine\.rackSlot && fromDepartment === "Assembly" && isRackReleaseHop\(fromDepartment, toDepartment\);/);
  assert.match(app, /rackReturn \? `✓ Assembled · Return to \$\{slotLabel\(machine\.rackSlot\)\}` : `Finish & Transfer → \$\{toDepartment\}`/);
  assert.match(app, /const canSendFromRack = canDo\("machines", "release"\) \|\| isAdminUser;/);
  assert.match(app, /label: "→ Transfer to Mechanical"/);
  assert.match(app, /if \(!authCanDo\("machines", "release"\) && !isAdmin\) return \{ success: false/);
  assert.match(app, /if \(!h\.releaseRequired \|\| h\.releasedAt\) return \{ success: false/);
  // the machine card no longer offers the direct release button: the only
  // release call left in the page is the Rack View transfer (2026-10-31 —
  // the dead `{false && …}` branch on the card was removed outright).
  assert.doesNotMatch(app, /\{false && canDo\("machines", "release"\)/);
  const releaseCalls = app.match(/await onReleaseHandover\(/g) || [];
  assert.equal(releaseCalls.length, 1, "exactly one release call — the Rack View transfer");
  assert.match(app, /const r = await onReleaseHandover\(ho\.id\);/);
  // workers, signature, checklist and pending-work sections stay in the popup
  assert.match(app, /Anything still pending from \{fromDepartment\}\?/);
  assert.match(app, /The Main Employee must sign to confirm this department's work\./);
});

// 2026-10-31 live bug (M-10 (2), S/N 123456789): a pulled-back (cancelled)
// hand-over kept the rack showing "Assembled · Ready" with an active
// Transfer button, which then failed with "Already released, or no longer
// waiting". Only a PENDING hand-over parks a machine on the rack; a release
// updates the hand-over first, then clears the slot (awaited), and a second
// release of the same hand-over is refused.
test("rack status: a cancelled or released hand-over never shows 'assembled'", () => {
  const log = [m(1, { bomKey: "M-10", stage: "Assembly", rackSlot: "M-10-1#2" })];
  const pending = new Set(["1"]);
  assert.equal(buildFamilyRacks(fam10, log, pending).columns[0][0].slots[1].status, "assembled");
  // the App only puts PENDING, unreleased hand-overs into awaitingReleaseIds; a
  // cancelled one is not in the set → the machine is simply "assembling" again
  assert.equal(buildFamilyRacks(fam10, log, new Set()).columns[0][0].slots[1].status, "assembling");
  // released → off the rack entirely
  const v = rackViewLog(log, [{ machineId: 1, releaseRequired: true, releasedAt: "2026-10-31T09:00:00Z", status: "pending" }]);
  assert.equal(buildFamilyRacks(fam10, v, new Set()).columns[0][0].slots[1].status, "empty");
});

test("App: release is pending-only, guarded against duplicates, and clears the rack slot awaited", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.match(app, /const isAwaitingRelease = \(h\) => !!\(h && h\.status === "pending" && h\.releaseRequired && !h\.releasedAt\);/);
  assert.match(app, /if \(h\.status !== "pending"\) return \{ success: false, error: h\.status === "cancelled" \? "This hand-over was pulled back/);
  assert.match(app, /if \(releaseBusyRef\.current\.has\(handoverId\)\) return \{ success: false, error: "Transfer already in progress" \};/);
  assert.match(app, /const cleared = await clearRackSlot\(machine, `released to/);
  assert.match(app, /const clearRackSlot = async \(machine, why\) => \{/);
  assert.match(app, /const r = await machineUpdate\(machine\.id, \{ rackSlot: null \}\);/);
  // the rack panel only ever offers Transfer for a PENDING hand-over
  assert.match(app, /const ho = sl\.status === "assembled" \? \(handovers \|\| \[\]\)\.find\(\(h\) => h && h\.status === "pending" && String\(h\.machineId\) === String\(m\.id\)\) : null;/);
});

// 2026-10-31 — direct hand-over acceptance from the machine card (same modal
// and handler as Transfer & Accept; duplicate acceptance refused).
test("App: Accept Machine on the card reuses the accept modal and refuses duplicates", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.match(app, /const cardCanAccept = !!h && h\.status === "pending" && canAcceptHandover\(canDo, h\.toDepartment\) && !!onAcceptHandover;/);
  assert.match(app, /data-card-accept=\{h\.id\}\n\s+onClick=\{\(\) => \{ if \(!acceptModal\) openAcceptModal\(h\); \}\}/);
  assert.match(app, /if \(!live \|\| live\.status !== "pending"\) \{ setAcceptModal\(null\); showToast\("Already accepted"/);
  // the Transfer & Accept section still offers its own button
  assert.match(app, /<button onClick=\{\(\) => openAcceptModal\(h\)\}/);
});

// 2026-10-31 — direct pending-job tracking from the machine card (same rows
// and actions as the Pending Jobs tab; the action modal keeps its busy guard
// and explicit confirmation).
test("App: Pending Jobs button on the card opens the shared job rows with existing actions", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.match(app, /const renderJobGroup = \(m, list, key\) => \{/);
  assert.match(app, /\{groups\.map\(\(\{ id, m, list \}\) => renderJobGroup\(m, list, id\)\)\}/, "the Pending Jobs tab uses the shared renderer");
  assert.match(app, /data-card-jobs=\{machine\.id\} onClick=\{\(\) => setJobsDrawer\(machine\.id\)\}/);
  assert.match(app, /\{open\.length > 0 && renderJobGroup\(m, open, "open"\)\}/, "the drawer uses the shared renderer");
  assert.match(app, /onClick=\{\(\) => setJobAction\(\{ item: p, action: "receive"/);
  assert.match(app, /onClick=\{\(\) => setJobAction\(\{ item: p, action: "complete"/);
  assert.match(app, /if \(jobAction\.busy\) return;/, "double submit guard kept");
});

// 2026-10-31 — Part received collects the Item Master verification for the
// item (critical serial per unit / critical checkbox / normal physical-receipt
// tick) before anything is recorded; the popup sits above the jobs drawer.
test("App: Part received asks for the item's configured verification and gates the save", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.match(app, /const inputType = critical && inv\.outwardInputType === "serial" \? "serial" : "checkbox";/);
  assert.match(app, /const receiveReady = !isReceive \|\| p\.receivedAt \|\| \(critical && inputType === "serial" \? !serialProblem : !!jobAction\.verified\);/);
  assert.match(app, /if \(isReceive && !receiveReady\) \{ setJobAction\(\(prev\) => prev \? \{ \.\.\.prev, error: receiveWhy \} : prev\); return; \}/);
  assert.match(app, /data-job-submit onClick=\{submit\} disabled=\{jobAction\.busy \|\| \(isReceive && !receiveReady\)\}/);
  assert.match(app, /await onReceivePendingItem\(p\.id, \{ notes: jobAction\.notes\.trim\(\), verification \}\)/);
  assert.match(app, /const handleReceivePendingItem = async \(id, \{ notes, verification = null \}\) => \{/);
  // popup above the Pending Jobs drawer (z-66) and the rack panel (z-65)
  const i = app.indexOf("{jobAction && (() => {");
  assert.ok(/className="modal-backdrop fixed inset-0 z-\[96\]/.test(app.slice(i, i + 9000)), "job action modal is top-most");
  // the stylesheet's .modal-backdrop { z-index: 50 } outranks the utility, so the value must be inline
  assert.ok(/backdropFilter: "blur\(12px\)", zIndex: 96 \}/.test(app.slice(i, i + 9000)), "job action modal z-index is inline (beats .modal-backdrop z-index:50)");
});

// 2026-10-31 — compact team picker; any Settings employee may be Main.
test("App: compact team picker, non-login Main Employee, migration 050", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  const store = fs.readFileSync(path.join(root, "src/stores/handoverStore.js"), "utf8");
  assert.match(app, /data-team-picker/);
  assert.match(app, /\{people\.map\(\(x\) => <option key=\{x\.id\} value=\{x\.id\}>\{x\.name\}\{x\.login \? "" : " \(no login\)"\}<\/option>\)\}/, "Main select lists logins and Settings employees");
  assert.match(app, /const mainIsLogin = !String\(mainEmployeeId\)\.startsWith\("emp:"\);/);
  assert.match(app, /mainEmployeeId: mainIsLogin \? mainEmployeeId : null,\n\s+mainEmployeeRef: mainEmployeeId,/);
  assert.doesNotMatch(app, /must have ERP login/, "no login-only restriction text");
  assert.match(store, /row\.main_employee_ref\s+= h\.mainEmployeeRef \|\| null;/);
  const up = fs.readFileSync(path.join(root, "supabase/migrations/050_handover_main_employee_ref.sql"), "utf8");
  assert.match(up, /ADD COLUMN IF NOT EXISTS main_employee_ref\s+text/);
  assert.doesNotMatch(up, /\b(DROP TABLE|TRUNCATE|DELETE FROM|ALTER POLICY|CREATE POLICY|DROP POLICY)\b/i);
});

// 2026-10-31 — Trial → Ready: only "I have checked this certificate" is
// required; incomplete certificates save and can be completed later. On Hold
// card and filter use the same machine list.
test("App: trial certificate confirmation-only gate, edit-later path, On Hold filter consistency", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.match(app, /const incomplete = \[\];\n  if \(!String\(cert\.trialByName/);
  assert.match(app, /const missing = \[\];\n/, "nothing is mandatory on the certificate");
  assert.match(app, /data-cert-submit\n\s+disabled=\{busy \|\| !confirmed\}/);
  assert.match(app, /function TrialCertificateModal\(\{ machine, nowTick, workflow, busy, onClose, onSubmit, initialCert = null, editOnly = false \}\)/);
  assert.match(app, /onSubmit=\{trialCertModal\.editOnly \? saveTrialCertificate : submitTrialCertificate\}/);
  assert.match(app, /const handleUpdateTrialCertificate = async \(machineId, cert\) => \{/);
  assert.match(app, /data-cert-edit onClick=\{\(\) => setTrialCertModal\(\{ machine, editOnly: true \}\)\}/);
  // On Hold: card count == filter list; card click switches to the production tab
  assert.match(app, /const holdCount = onHold\.length;/);
  assert.match(app, /setMtTab\("production"\); setFilter\(filter === c\.key \? "all" : c\.key\);/);
  assert.match(app, /h\.status === "pending" && \(h\.id === m\.pendingHandoverId \|\| String\(h\.machineId\) === String\(m\.id\)\)/);
});

// 2026-10-31 — Report Center: opened from the Machine Tracker top bar (no
// sidebar entry); seven reports; serial filter; Excel/CSV + PDF; settings for
// signature / stamp, page layout and displayed fields.
test("App: Report Center navigation, seven reports, filters, exports and settings", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.doesNotMatch(app, /\{ id: "reports",\s+Icon: TrendingUp,\s+label: "Report Center"/, "no sidebar entry");
  assert.match(app, /data-open-reports onClick=\{\(\) => onNavigate\("reports"\)\}/, "Reports button on the Machine Tracker top bar");
  for (const id of ["factory", "owner", "department", "stuck", "machine", "monthly", "customer"]) assert.match(app, new RegExp(`\\{ id: "${id}",\\s+label: "`), `report tab ${id}`);
  assert.match(app, /const \[serialFilter, setSerialFilter\] = useState\(""\);/);
  assert.match(app, /data-filter-model/); assert.match(app, /data-filter-serial/);
  assert.match(app, /data-export-excel/); assert.match(app, /data-export-pdf/);
  assert.match(app, /const departmentRows = DEPARTMENT_SEQUENCE/); assert.match(app, /const monthlyRows = \(\(\) => \{/); assert.match(app, /const ownerRows = \(\(\) => \{/);
  assert.match(app, /signatureImage: "", signatureLabel: "Authorised Signatory", pageSize: "A4", orientation: "portrait"/);
  assert.match(app, /@page \{ size: \$\{rc\.pageSize \|\| "A4"\} \$\{rc\.orientation \|\| "portrait"\}; margin: 12mm; \}/);
  assert.match(app, /show\.showPendingJobs === false \|\| !machinePending\.length/);
  // customer PDF is printed / saved, never linked
  assert.doesNotMatch(app, /share(able)? link/i);
});

// 2026-10-31 — Admin Data Cleanup (migration 051): admin-only panel in
// Settings → Data & Backup; keep-list selection; server preview; password
// re-auth + typed DELETE; single-transaction DB function guarded by the
// previewed id set; master data and the immutable audit log untouched.
test("App + migration 051: Admin Data Cleanup is admin-gated, previewed, password-verified and atomic", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  const sql = fs.readFileSync(path.join(root, "supabase/migrations/051_admin_cleanup.sql"), "utf8");
  const audit = fs.readFileSync(path.join(root, "src/auth/auditStore.js"), "utf8");
  // UI gate + wiring
  assert.match(app, /\(isSuperAdmin \|\| canDo\("machines", "configDept"\)\) && \(\s*<AdminCleanupPanel machineLog=\{machineLog\} currentUser=\{currentUser\} onDone=\{onAdminCleanup\} \/>/);
  assert.match(app, /machineLog=\{machineLog\} onAdminCleanup=\{handleAdminCleanupDone\}/);
  // preview is read-only; execute needs password + DELETE + the previewed ids
  assert.match(app, /rpc\("admin_cleanup_machines", \{ p_keep_ids: keepIds\(\), p_execute: false \}\)/);
  assert.match(app, /const re = await reauthenticateByPassword\(authEmail, password\);\s*if \(!re\.success\) throw/);
  assert.match(app, /if \(typed\.trim\(\) !== "DELETE"\)/);
  assert.match(app, /rpc\("admin_cleanup_machines", \{ p_keep_ids: keepIds\(\), p_execute: true, p_expected_ids: expected \}\)/);
  assert.match(app, /if \(!supa\) \{ setError\("Data cleanup needs the live database/, "local mode fails closed");
  for (const h of ["data-cleanup-preview", "data-cleanup-password", "data-cleanup-typed", "data-cleanup-execute", "data-cleanup-summary", "data-keep-all", "data-keep-none"]) assert.match(app, new RegExp(h), h);
  // local state follow-up: local-only audit entry (DB row written by the function)
  assert.match(app, /appendAuditWithUser\(\{ type: "admin_cleanup", module: "Machine",[\s\S]*?\}, \{ mirror: false \}\);/);
  assert.match(audit, /if \(opts\.mirror !== false\) tryWriteToSupabase\(full\);/);
  // DB function: admin-only, preview mode, expected-id guard, cascade delete, audit insert, never touches master data
  assert.match(sql, /v_user\.role_key = 'super_admin' OR public\.has_permission\('machines', 'configDept'\)/);
  assert.match(sql, /IF NOT p_execute THEN\s*RETURN jsonb_build_object\('mode', 'preview'/);
  assert.match(sql, /IF p_expected_ids IS NULL THEN\s*RAISE EXCEPTION 'Preview required before cleanup'/);
  assert.match(sql, /Machine list changed since the preview/);
  assert.match(sql, /DELETE FROM public\.outward_log WHERE serial_no = ANY\(v_serials\);\s*DELETE FROM public\.machine_log WHERE id = ANY\(v_ids\);/);
  assert.match(sql, /INSERT INTO public\.audit_log \(user_id, user_name, user_role, type, module, action, details\)/);
  for (const t of ["items", "stock", "bom_definitions", "users", "settings", "vendors", "purchase_orders", "inward_log"]) assert.doesNotMatch(sql, new RegExp(`DELETE FROM public\\.${t}\\b`), `never deletes ${t}`);
  assert.doesNotMatch(sql, /DELETE FROM public\.audit_log|ALTER TABLE public\.audit_log|DISABLE TRIGGER/, "audit log stays immutable");
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.admin_cleanup_machines\(bigint\[\], boolean, bigint\[\]\) TO authenticated;/);
});

// 2026-10-31 — Machine Tracker redesign: four production stages ending at
// Ready (no "Completed" stage), three primary tabs with no duplicated summary
// box, a clearable filter chip so the On Hold card is self-explanatory, one
// card per machine with no repeated controls, and a cream/gold page scope.
test("App: Machine Tracker — Ready is the final stage, filters clear, cards are not duplicated", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  const css = fs.readFileSync(path.join(root, "src/index.css"), "utf8");

  // 1 — stages: Mechanical → Electrical → Trial → Ready, Ready last
  assert.match(app, /const DISPLAY_STAGES = \["Mechanical", "Electrical", "Trial", "Ready"\];/);
  assert.match(app, /const displayStageOf = \(m\) => \(m && m\.status === "completed" \? "Ready" : \(m && m\.stage\) \|\| ""\);/);
  assert.match(app, /const dispIdx = DISPLAY_STAGES\.indexOf\(dispStage\);/);
  assert.doesNotMatch(app, /"Completed":\s+"#15803d"/, "no Completed stage colour");
  // the machine card's "✓ Completed" stage badge is gone (the pending-job
  // chips of the same wording are a different thing and stay)
  assert.doesNotMatch(app, /border:"1px solid rgba\(34,197,94,0\.25\)" \}\}>\s*\n\s*✓ Completed/);
  // the status column itself is untouched — history and rack guards read it
  assert.match(app, /const isComplete = machine\.status === "completed";/);

  // 2 — three primary tabs; Pending Jobs is a tab, not also a summary box
  for (const id of ["production", "transfer", "pending"]) assert.match(app, new RegExp(`\\{ id: "${id}",`));
  assert.doesNotMatch(app, /key: "jobs",\s+label: "Pending Jobs"/, "no duplicate Pending Jobs summary card");
  assert.match(app, /xl:grid-cols-5 gap-3/, "five summary cards");
  assert.match(app, /\{ key: "completed",\s+label: "Ready",/);

  // 3 — On Hold (and every other card filter) toggles and can be cleared
  assert.match(app, /const holdCount = onHold\.length;/);
  assert.match(app, /setMtTab\("production"\); setFilter\(filter === c\.key \? "all" : c\.key\);/);
  assert.match(app, /data-filter-all onClick=\{\(\) => setFilter\("all"\)\}/);
  assert.match(app, /data-filter-clear onClick=\{\(\) => setFilter\("all"\)\}/);
  assert.match(app, /const MT_FILTER_LABELS = \{[\s\S]*?hold: "On HOLD"/);

  // 4 — one card, no repeated actions; the working ones are all still there
  assert.match(app, /className=\{`mt-card overflow-hidden\$\{isComplete \? " mt-card-ready" : ""\}`\}/);
  assert.doesNotMatch(app, /jobs? owed\n/, "the owed badge no longer repeats the Pending Jobs button");
  assert.match(app, /\{!isComplete && machine\.trialCertificate && canFinishTransfer\(canDo\) && onUpdateTrialCertificate && \(/);
  for (const action of ["Report Issue", "Finish & Transfer →", "✓ Accept Machine", "data-card-jobs", "data-card-accept", '{isExpanded ? "Hide" : "History"}'])
    assert.ok(app.includes(action), `card keeps ${action}`);

  // 5/6 — premium scope and aligned header
  assert.match(app, /className="flex-1 overflow-y-auto mt-premium"/);
  assert.match(css, /\.mt-premium \{[\s\S]*?--surface-card:\s+#FFFDF8;/);
  assert.match(css, /\.mt-premium \.mt-card \{/);
  assert.match(css, /--mt-gold:\s+#A8842C;/);
  assert.match(css, /@media \(max-width: 640px\) \{[\s\S]*?\.mt-premium/);
  assert.match(app, /<Topbar title="Machine Tracker" subtitle="Mechanical → Electrical → Trial → Ready">/);
  assert.match(app, /data-open-reports[\s\S]{0,200}h-9 px-3 rounded-lg/);
  assert.match(app, /tabular-nums hidden sm:flex/, "clock visible from small screens up");
});
