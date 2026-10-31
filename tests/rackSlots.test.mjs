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
