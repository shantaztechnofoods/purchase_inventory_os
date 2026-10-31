import { test } from "node:test";
import assert from "node:assert/strict";
import { rackViewLog, PHYSICAL_RACK_LAYOUT, rackOfBom, rackBoms, rackCapacityFor, familySlotIds, buildFamilyRacks, firstFreeSlot, canAssignSlot, slotLabel, slotStatusOf, pairSlotOf, setSlotOf, setLabel, bomFillCheck, rCrateIssues } from "../src/utils/rackSlots.js";

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

test("M/R pairing: unit n of M and unit n of R are ONE machine set", () => {
  assert.equal(pairSlotOf("M-10-1#1"), "R-10-1#1");
  assert.equal(pairSlotOf("R-20-1#2"), "M-20-1#2");
  assert.equal(setSlotOf("R-15-1#2"), "M-15-1#2");
  assert.equal(setSlotOf("M-15-1#2"), "M-15-1#2");
  assert.equal(setLabel("R-10-1#1"), "M-10 (1) + R-10 (1)");
  const log = [mm(1, "M-10"), mm(2, "M-10"), mm(3, "M-10")];
  const { placed, overflow, columns } = buildFamilyRacks(fam10, log);
  assert.equal(placed["M-10-1#1"].machine.id, 1);
  assert.equal(placed["R-10-1#1"].machine.id, 1, "R unit shows the same machine (shared serial)");
  assert.equal(placed["R-10-1#1"].paired, true);
  assert.equal(placed["M-10-1#2"].machine.id, 2);
  assert.equal(placed["R-10-1#2"].machine.serialNo, placed["M-10-1#2"].machine.serialNo);
  assert.deepEqual(overflow.map((x) => x.id), [3], "two sets per model — a third machine is overflow, never a second machine on an R unit");
  assert.equal(columns[0][1].slots[0].machine.id, 1);
  assert.equal(columns[0][1].slots[0].setId, "M-10-1#1");
});

test("an older R slot id or a legacy R machine still means its set; a foreign slot is ignored", () => {
  const p1 = buildFamilyRacks(fam10, [mm(5, "M-10", { rackSlot: "R-10-1#2" })]).placed;
  assert.equal(p1["M-10-1#2"].machine.id, 5); assert.equal(p1["M-10-1#2"].pinned, true);
  const p2 = buildFamilyRacks(fam10, [mm(6, "M-10", { rackSlot: "M-15-1#1" })]).placed;
  assert.equal(p2["M-10-1#1"].machine.id, 6); assert.equal(p2["M-10-1#1"].pinned, false);
  const p3 = buildFamilyRacks(fam10, [mm(7, "M-10", { rackSlot: "M-10-1#2" }), mm(8, "R-10", { rackSlot: "R-10-1#2" })]);
  assert.equal(p3.placed["M-10-1#2"].machine.id, 7);
  assert.equal(p3.placed["M-10-1#1"].machine.id, 8, "a contested set keeps the oldest; the other set-less BOM-issued machine flows into the free set");
});

test("legacy KM10 machine keeps its saved set (live fcbf: M-10-1#2)", () => {
  const log = [mm(64, "KM10", { serialNo: "fcbf", rackSlot: "M-10-1#2" })];
  const { placed } = buildFamilyRacks(fam10, log);
  assert.equal(placed["M-10-1#2"].machine.serialNo, "fcbf");
  assert.equal(placed["R-10-1#2"].machine.serialNo, "fcbf");
  assert.equal(placed["M-10-1#2"].pinned, true);
  assert.equal(firstFreeSlot("M-10", log), "M-10-1#1");
  assert.equal(firstFreeSlot("R-10", log), "M-10-1#1");
});

test("set status: set / assembling / assembled / empty, the same on both units", () => {
  const awaiting = new Set(["5"]);
  const log = [mm(4, "M-10", { rackSlot: "M-10-1#1", stage: "Assembly" }), mm(5, "M-10", { rackSlot: "M-10-1#2", stage: "Assembly" }), mm(6, "M-10", { stage: "Mechanical", rackSlot: "R-10-1#1" })];
  const { columns } = buildFamilyRacks(fam10, log, awaiting);
  assert.equal(columns[0][0].slots[0].status, "assembling");
  assert.equal(columns[0][1].slots[0].status, "assembling");
  assert.equal(columns[0][0].slots[1].status, "assembled");
  assert.equal(columns[0][1].slots[1].status, "assembled");
  assert.equal(columns[0][0].name, "M-10");
  assert.equal(columns[0][1].name, "R-10");
  assert.equal(slotStatusOf(null), "empty");
});

test("firstFreeSlot: returns the free set's M slot; preferred M or R unit; full → null; no rack → null", () => {
  const log = [mm(1, "M-10", { rackSlot: "M-10-1#1" })];
  assert.equal(firstFreeSlot("M-10", log), "M-10-1#2");
  assert.equal(firstFreeSlot("M-10", log, new Set(), "R-10-1#2"), "M-10-1#2");
  assert.equal(firstFreeSlot("M-10", log, new Set(), "R-10-1#1"), "M-10-1#2", "a taken set is never preferred");
  assert.equal(firstFreeSlot("AM900", log), null);
  const full = [mm(1, "M-10", { rackSlot: "M-10-1#1" }), mm(2, "M-10", { rackSlot: "M-10-1#2" })];
  assert.equal(firstFreeSlot("M-10", full), null);
  assert.equal(firstFreeSlot("R-10", full), null, "R units are full when their M units are");
  assert.equal(firstFreeSlot("M-15", full), "M-15-1#1");
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
test("App: separate M/R BOM fills under one serial, remove, release scope and permissions", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  assert.doesNotMatch(app, /mergeSetBomItems|setFillCheck/, "M and R BOMs are never merged");
  assert.match(app, /const drawerBom = bomDefs\[openBOM\];/, "the drawer always shows the rack's own BOM");
  // M fill places the machine; R fill is a crate under the same serial, no new machine
  assert.match(app, /setBomOpenRequest\(\{ key: bomKey, slotId: setId, mode: "set"/);
  assert.match(app, /setBomOpenRequest\(\{ key: bomKey, slotId: pairSlotOf\(setId\), mode: "crate", serialNo: holder\.serialNo/);
  assert.match(app, /if \(data\.serialNo && onCreateMachine && !\(data\.rackSet && data\.rackSet\.mode === "crate"\)\)/);
  assert.match(app, /setSerialModal\(null\); setActiveSerial\(bomOpenRequest\.serialNo \|\| ""\); setOpenBOM\(bomOpenRequest\.key\);/, "R crate never asks for a new serial");
  // 3 — no destination popup on a rack fill
  assert.match(app, /if \(serialNo && !chosenDest && rackSet\) \{\n      \/\/ A set fill has one destination: the selected set\. No popup\.\n      return doIssue\("rack"/);
  // 4 — any unticked / short / skipped / unknown line blocks a rack fill
  assert.match(app, /!isItemChecked\(i\.code\) \|\| !i\.inv \|\| i\.pendingQty > 0 \|\| i\.issueQty < i\.required \|\| skippedCodes\.has\(i\.code\)/);
  assert.match(app, /\} else if \(serialNo && rackTracked\) \{/, "a rack BOM is never issued as a machine outside the Rack View");
  // assemble waits for a defined R crate
  assert.match(app, /sl\.status === "set" && pend\.length === 0 && crate\.state !== "pending" && canDo\("machines", "updateStage"\)/);
  // 5 — remove from rack reverses the M issue and the R crate
  assert.match(app, /const handleRemoveRackMachine = async \(machineId\) => \{\n    if \(!authCanDo\("outward", "delete"\)\)/);
  assert.match(app, /const entries = \[outwardEntry, \.\.\.crateEntries\]\.filter\(Boolean\);/);
  assert.match(app, /Nothing was removed — the set is still on the rack\./);
  assert.match(app, /data-action="remove"/);
  // 6 — only rack-slot machines are parked for release
  assert.match(app, /payload\.releaseRequired = !!machine\.rackSlot && RACK_RELEASE_HOPS\.some\(/);
  // 7 — permissions; one serial per set, never shared by the two sets of a model
  assert.match(app, /const handleStartProduction = \(machineIds\) => \{\n    if \(!authCanDo\("machines", "updateStage"\)\)/);
  assert.match(app, /if \(!canFinishTransfer\(authCanDo\)\) return \{ success: false/);
  assert.match(app, /is already used by an active \$\{rk\.family\.label\} machine set/);
});

test("migration 047 guards one machine per set and M-slot pairing in the database", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const up = fs.readFileSync(path.join(root, "supabase/migrations/047_rack_set_guard.sql"), "utf8");
  const up48 = fs.readFileSync(path.join(root, "supabase/migrations/048_rack_set_serial_guard.sql"), "utf8");
  assert.match(up48, /already used by machine/);
  assert.doesNotMatch(up48, /\b(DROP TABLE|TRUNCATE|DELETE FROM|ALTER POLICY|CREATE POLICY|DROP POLICY)\b/i);
  const down = fs.readFileSync(path.join(root, "supabase/migrations/047_rack_set_guard_rollback.sql"), "utf8");
  assert.match(up, /pg_advisory_xact_lock/);
  assert.match(up, /CREATE TRIGGER machine_log_rack_set_guard/);
  assert.match(up, /machine_log_rack_slot_is_set/);
  assert.doesNotMatch(up, /\b(DROP TABLE|TRUNCATE|DELETE FROM|ALTER POLICY|CREATE POLICY|DROP POLICY)\b/i, "additive only, no RLS change");
  assert.match(down, /DROP TRIGGER IF EXISTS machine_log_rack_set_guard/);
});
