// Unit tests for src/utils/teamMemory.js — the pure core only.
//
// readTeamMemory / writeTeamMemory are thin localStorage wrappers and are not
// covered here; what matters is that a remembered crew can never put a person
// on a handover who is no longer eligible, and that a remembered Main Employee
// can never be someone who cannot sign.
import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileTeam, pickRememberedMain } from "../src/utils/teamMemory.js";

const RAMESH = "11111111-1111-1111-1111-111111111111";
const SURESH = "22222222-2222-2222-2222-222222222222";
const MIHIR  = "33333333-3333-3333-3333-333333333333";

test("reconcileTeam: keeps remembered members that are still eligible", () => {
  assert.deepEqual(
    reconcileTeam([RAMESH, SURESH], [SURESH, RAMESH, MIHIR]),
    [RAMESH, SURESH],
  );
});

test("reconcileTeam: preserves the remembered order, not the eligible order", () => {
  assert.deepEqual(
    reconcileTeam([SURESH, RAMESH], [RAMESH, SURESH]),
    [SURESH, RAMESH],
  );
});

test("reconcileTeam: drops a member who left the eligible pool", () => {
  // Suresh was deactivated in Settings, or moved out of this department.
  // He must not reappear pre-ticked on a handover.
  assert.deepEqual(reconcileTeam([RAMESH, SURESH], [RAMESH, MIHIR]), [RAMESH]);
});

test("reconcileTeam: nobody eligible any more → empty, never a stale crew", () => {
  assert.deepEqual(reconcileTeam([RAMESH, SURESH], []), []);
});

test("reconcileTeam: de-duplicates a repeated remembered member", () => {
  assert.deepEqual(reconcileTeam([RAMESH, RAMESH, SURESH], [RAMESH, SURESH]), [RAMESH, SURESH]);
});

test("reconcileTeam: handles the emp: synthetic ids used for factory workers", () => {
  assert.deepEqual(
    reconcileTeam(["emp:7", "emp:9", RAMESH], ["emp:7", RAMESH]),
    ["emp:7", RAMESH],
  );
});

test("reconcileTeam: works on plain names, the shape the Accept modal uses", () => {
  assert.deepEqual(
    reconcileTeam(["Ramesh Patel", "Dinesh Shah"], ["Ramesh Patel", "Suresh Yadav"]),
    ["Ramesh Patel"],
  );
});

test("reconcileTeam: compares by string, so a numeric id survives a type change", () => {
  assert.deepEqual(reconcileTeam([7, 9], ["7", "8"]), [7]);
});

test("reconcileTeam: tolerates null, undefined and non-arrays", () => {
  assert.deepEqual(reconcileTeam(null, [RAMESH]), []);
  assert.deepEqual(reconcileTeam([RAMESH], null), []);
  assert.deepEqual(reconcileTeam(undefined, undefined), []);
  assert.deepEqual(reconcileTeam("nope", [RAMESH]), []);
});

test("reconcileTeam: skips null entries on both sides", () => {
  assert.deepEqual(reconcileTeam([null, RAMESH, undefined], [RAMESH, null]), [RAMESH]);
});

test("pickRememberedMain: returns the remembered main when still on the team", () => {
  assert.equal(pickRememberedMain([RAMESH, SURESH], SURESH), SURESH);
});

test("pickRememberedMain: null when the remembered main is no longer on the team", () => {
  assert.equal(pickRememberedMain([RAMESH], SURESH), null);
});

test("pickRememberedMain: never picks an emp: factory worker — they cannot sign", () => {
  assert.equal(pickRememberedMain(["emp:7", RAMESH], "emp:7"), null);
});

test("pickRememberedMain: null for empty / missing input", () => {
  assert.equal(pickRememberedMain([], RAMESH), null);
  assert.equal(pickRememberedMain([RAMESH], null), null);
  assert.equal(pickRememberedMain(null, RAMESH), null);
  assert.equal(pickRememberedMain([RAMESH], undefined), null);
});

test("pickRememberedMain: matches by string so a numeric id still resolves", () => {
  assert.equal(pickRememberedMain([7, 9], "7"), 7);
});

test("remembered crew survives reconcile → main is still valid", () => {
  const team = reconcileTeam([RAMESH, SURESH, "emp:7"], [RAMESH, "emp:7", MIHIR]);
  assert.deepEqual(team, [RAMESH, "emp:7"]);
  assert.equal(pickRememberedMain(team, SURESH), null, "Suresh is gone, so no main");
  assert.equal(pickRememberedMain(team, RAMESH), RAMESH);
});
