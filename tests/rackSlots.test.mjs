import { test } from "node:test";
import assert from "node:assert/strict";
import { PHYSICAL_RACK_LAYOUT, physicalRackFamily, rackCapacityFor, familySlotIds, buildFamilyRacks, firstFreeSlot, canAssignSlot, slotLabel, slotStatusOf } from "../src/utils/rackSlots.js";

const fam10 = PHYSICAL_RACK_LAYOUT.families[0];
const m = (id, over = {}) => ({ id, bomKey: "KM10", serialNo: `S${id}`, stage: "BOM Issued", status: "active", createdDate: `2026-10-${String(10 + id).padStart(2, "0")}`, ...over });

test("layout unchanged: 2 columns × M/R × 2 sets = 8 slots per family", () => {
  assert.equal(rackCapacityFor("KM10"), 8);
  assert.equal(rackCapacityFor("KM-10"), 8);
  assert.equal(rackCapacityFor("AM900"), 0);
  assert.equal(physicalRackFamily("TM600"), null);
  assert.deepEqual(familySlotIds(fam10).slice(0, 4), ["M-10-1#1", "M-10-1#2", "R-10-1#1", "R-10-1#2"]);
  assert.equal(slotLabel("M-10-1#2"), "M-10 (1) · slot 2");
});

test("legacy machines without a slot fill oldest-first; pinned slots are exact", () => {
  const log = [m(3), m(1), m(2, { rackSlot: "R-10-2#1" })];
  const { columns, overflow, placed } = buildFamilyRacks(fam10, log);
  assert.equal(placed["R-10-2#1"].machine.id, 2);
  assert.equal(placed["M-10-1#1"].machine.id, 1);
  assert.equal(placed["M-10-1#2"].machine.id, 3);
  assert.equal(overflow.length, 0);
  assert.equal(columns[0][0].state, "full");
  assert.equal(columns[1][1].state, "partial");
  assert.equal(columns[0][1].state, "empty");
});

test("slot status: set / assembling / assembled / empty; released machine leaves the slot", () => {
  const awaiting = new Set(["5"]);
  const log = [m(4, { rackSlot: "M-10-1#1", stage: "Assembly" }), m(5, { rackSlot: "M-10-1#2", stage: "Assembly" }), m(6, { stage: "Mechanical", rackSlot: "R-10-1#1" })];
  const { columns, placed } = buildFamilyRacks(fam10, log, awaiting);
  assert.equal(columns[0][0].slots[0].status, "assembling");
  assert.equal(columns[0][0].slots[1].status, "assembled");
  assert.equal(placed["R-10-1#1"], undefined, "a machine past Assembly is not on the rack even if the column is stale");
  assert.equal(slotStatusOf(null), "empty");
});

test("firstFreeSlot honours a preferred empty slot and refuses a full rack", () => {
  const log = [m(1, { rackSlot: "M-10-1#1" })];
  assert.equal(firstFreeSlot("KM10", log), "M-10-1#2");
  assert.equal(firstFreeSlot("KM10", log, new Set(), "R-10-2#2"), "R-10-2#2");
  assert.equal(firstFreeSlot("KM10", log, new Set(), "M-10-1#1"), "M-10-1#2");
  assert.equal(firstFreeSlot("AM900", log), null);
  const full = familySlotIds(fam10).map((s, i) => m(i + 1, { rackSlot: s }));
  assert.equal(firstFreeSlot("KM10", full), null);
});

test("canAssignSlot: no double assignment, model must match rack, only rack machines", () => {
  const log = [m(1, { rackSlot: "M-10-1#1" }), m(2), { ...m(3), bomKey: "KM15" }];
  assert.equal(canAssignSlot(log[1], "M-10-1#1", log).ok, false);
  assert.equal(canAssignSlot(log[1], "M-10-1#2", log).ok, true);
  assert.equal(canAssignSlot(log[2], "M-10-1#2", log).ok, false);
  assert.equal(canAssignSlot({ ...log[1], stage: "Mechanical" }, "M-10-1#2", log).ok, false);
  // The auto-filled machine 2 sits in M-10-1#2 visually but is not pinned, so
  // pinning a different machine there is allowed (machine 2 re-flows).
  assert.equal(canAssignSlot(m(9), "M-10-1#2", log).ok, true);
});
