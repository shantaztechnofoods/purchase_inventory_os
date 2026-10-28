// Unit tests for src/utils/handoverLogic.js — pure functions, no React.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEPARTMENT_SEQUENCE, DEFAULT_DEPT_DURATIONS, DEFAULT_ACCEPT_TIMEOUT_MINUTES,
  readDeptWorkflowSettings, writeDeptWorkflowSettings,
  nextDepartment, computeElapsedMinutes, computeOverrun, isHoldOverdue, heldMinutes,
  formatDuration, canAcceptHandover, canFinishTransfer, canConfigureDept, workerIdsOf,
} from "../src/utils/handoverLogic.js";

// ─── nextDepartment ────────────────────────────────────────────────────────

test("nextDepartment follows the fixed stage sequence", () => {
  assert.equal(nextDepartment("Assembly"), "Mechanical");
  assert.equal(nextDepartment("Mechanical"), "Electrical");
  assert.equal(nextDepartment("Electrical"), "Trial");
  assert.equal(nextDepartment("Trial"), "Ready");
});

test("nextDepartment returns null at terminal states", () => {
  // Ready is terminal; BOM Issued transitions via Start Production, not handover.
  assert.equal(nextDepartment("Ready"), null);
  assert.equal(nextDepartment("BOM Issued"), null);
  assert.equal(nextDepartment("UNKNOWN"), null);
});

test("DEPARTMENT_SEQUENCE is frozen and matches MACHINE_STAGES", () => {
  assert.throws(() => { DEPARTMENT_SEQUENCE[0] = "X"; });
  assert.deepEqual(DEPARTMENT_SEQUENCE, ["BOM Issued", "Assembly", "Mechanical", "Electrical", "Trial", "Ready"]);
});

// ─── Defaults ──────────────────────────────────────────────────────────────

test("DEFAULT_ACCEPT_TIMEOUT_MINUTES is 120 (= 2 hours)", () => {
  assert.equal(DEFAULT_ACCEPT_TIMEOUT_MINUTES, 120);
});

test("DEFAULT_DEPT_DURATIONS covers Assembly / Mechanical / Electrical / Trial", () => {
  assert.ok(DEFAULT_DEPT_DURATIONS.Assembly.minutes > 0);
  assert.ok(DEFAULT_DEPT_DURATIONS.Mechanical.minutes > 0);
  assert.ok(DEFAULT_DEPT_DURATIONS.Electrical.minutes > 0);
  assert.ok(DEFAULT_DEPT_DURATIONS.Trial.minutes > 0);
  // Documented defaults per design doc §12.1
  assert.equal(DEFAULT_DEPT_DURATIONS.Assembly.minutes,   2 * 24 * 60);
  assert.equal(DEFAULT_DEPT_DURATIONS.Mechanical.minutes, 2 * 24 * 60);
  assert.equal(DEFAULT_DEPT_DURATIONS.Electrical.minutes, 1 * 24 * 60);
  assert.equal(DEFAULT_DEPT_DURATIONS.Trial.minutes,      8 * 60);
});

// ─── readDeptWorkflowSettings ──────────────────────────────────────────────

test("readDeptWorkflowSettings falls back to defaults when key is absent", () => {
  const r = readDeptWorkflowSettings({});
  assert.equal(r.accept_timeout_minutes, 120);
  assert.deepEqual(r.dept_durations, DEFAULT_DEPT_DURATIONS);
});

test("readDeptWorkflowSettings: require_password_at_accept defaults to false (easier-ops UX)", () => {
  const r = readDeptWorkflowSettings({});
  assert.equal(r.require_password_at_accept, false);
});

test("readDeptWorkflowSettings: require_password_at_accept reflects explicit true", () => {
  const r = readDeptWorkflowSettings({ department_workflow: { require_password_at_accept: true } });
  assert.equal(r.require_password_at_accept, true);
});

test("readDeptWorkflowSettings: non-boolean require_password_at_accept falls back to default", () => {
  const r = readDeptWorkflowSettings({ department_workflow: { require_password_at_accept: "yes" } });
  // Only explicit boolean counts; strings / numbers / null → default (false)
  assert.equal(r.require_password_at_accept, false);
});

test("readDeptWorkflowSettings merges partial overrides on top of defaults", () => {
  const r = readDeptWorkflowSettings({
    department_workflow: {
      dept_durations: { Trial: { minutes: 60 } },
      accept_timeout_minutes: 30,
    },
  });
  assert.equal(r.accept_timeout_minutes, 30);
  assert.equal(r.dept_durations.Trial.minutes, 60);
  // Other departments keep their defaults
  assert.equal(r.dept_durations.Assembly.minutes, DEFAULT_DEPT_DURATIONS.Assembly.minutes);
});

test("readDeptWorkflowSettings rejects negative / non-finite timeout and falls back", () => {
  const r = readDeptWorkflowSettings({ department_workflow: { accept_timeout_minutes: -5 } });
  // We clamp bad values to the default (negative isn't valid)
  assert.equal(r.accept_timeout_minutes, 120);
  const r2 = readDeptWorkflowSettings({ department_workflow: { accept_timeout_minutes: "oops" } });
  assert.equal(r2.accept_timeout_minutes, 120);
});

// ─── writeDeptWorkflowSettings ─────────────────────────────────────────────

test("writeDeptWorkflowSettings normalizes integers and clamps negatives to 0", () => {
  const out = writeDeptWorkflowSettings({}, {
    dept_durations: { Assembly: { minutes: 45.7 }, Mechanical: { minutes: -10 }, Electrical: { minutes: "600" } },
    accept_timeout_minutes: 90.9,
  });
  assert.equal(out.department_workflow.dept_durations.Assembly.minutes, 45);
  assert.equal(out.department_workflow.dept_durations.Mechanical.minutes, 0);
  assert.equal(out.department_workflow.dept_durations.Electrical.minutes, 600);
  assert.equal(out.department_workflow.accept_timeout_minutes, 90);
});

test("writeDeptWorkflowSettings preserves other settings fields untouched", () => {
  const prev = { companyName: "SHANTAZ", po: { template: "a4" }, random: "value" };
  const out = writeDeptWorkflowSettings(prev, { dept_durations: {}, accept_timeout_minutes: 120 });
  assert.equal(out.companyName, "SHANTAZ");
  assert.deepEqual(out.po, { template: "a4" });
  assert.equal(out.random, "value");
  assert.ok(out.department_workflow);
});

// ─── computeElapsedMinutes ─────────────────────────────────────────────────

test("computeElapsedMinutes handles missing / malformed input", () => {
  assert.equal(computeElapsedMinutes(null), 0);
  assert.equal(computeElapsedMinutes(undefined), 0);
  assert.equal(computeElapsedMinutes("not a date"), 0);
  assert.equal(computeElapsedMinutes(""), 0);
});

test("computeElapsedMinutes returns minute-difference between enteredAt and now", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const enteredAt = new Date(now - 2 * 60 * 60 * 1000).toISOString();  // 2 hours ago
  assert.equal(computeElapsedMinutes(enteredAt, now), 120);
});

test("computeElapsedMinutes treats future enteredAt as 0 (not negative)", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const future = new Date(now + 60 * 60 * 1000).toISOString();
  assert.equal(computeElapsedMinutes(future, now), 0);
});

// ─── computeOverrun ────────────────────────────────────────────────────────

test("computeOverrun reports no overrun under the limit", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const enteredAt = new Date(now - 60 * 60 * 1000).toISOString(); // 1h ago
  const r = computeOverrun(enteredAt, 120, now); // expected 2h
  assert.equal(r.actualMinutes, 60);
  assert.equal(r.expectedMinutes, 120);
  assert.equal(r.overrunMinutes, 0);
  assert.equal(r.isOverrun, false);
});

test("computeOverrun flags overrun past the limit", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const enteredAt = new Date(now - 3 * 60 * 60 * 1000).toISOString(); // 3h ago
  const r = computeOverrun(enteredAt, 120, now); // expected 2h
  assert.equal(r.actualMinutes, 180);
  assert.equal(r.overrunMinutes, 60);
  assert.equal(r.isOverrun, true);
});

// ─── isHoldOverdue + heldMinutes ───────────────────────────────────────────

test("isHoldOverdue is false before the timeout expires", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const sent = new Date(now - 60 * 60 * 1000).toISOString(); // 1h ago
  assert.equal(isHoldOverdue(sent, 120, now), false);     // 2h timeout
});

test("isHoldOverdue is true past the timeout", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  const sent = new Date(now - 3 * 60 * 60 * 1000).toISOString(); // 3h ago
  assert.equal(isHoldOverdue(sent, 120, now), true);
});

test("isHoldOverdue returns false for malformed timestamps", () => {
  assert.equal(isHoldOverdue(null, 120), false);
  assert.equal(isHoldOverdue("not-a-date", 120), false);
});

test("heldMinutes returns 0 when not overdue, (now-sent-timeout) when overdue", () => {
  const now = Date.parse("2026-10-16T12:00:00Z");
  assert.equal(heldMinutes(new Date(now - 60 * 60 * 1000).toISOString(), 120, now), 0);
  // 3h since sent, timeout 2h → 60min overdue
  assert.equal(heldMinutes(new Date(now - 3 * 60 * 60 * 1000).toISOString(), 120, now), 60);
});

// ─── formatDuration ────────────────────────────────────────────────────────

test("formatDuration handles minutes under 60", () => {
  assert.equal(formatDuration(0), "0m");
  assert.equal(formatDuration(45), "45m");
  assert.equal(formatDuration(59), "59m");
});

test("formatDuration handles hours", () => {
  assert.equal(formatDuration(60), "1h");
  assert.equal(formatDuration(90), "1h 30m");
  assert.equal(formatDuration(23 * 60), "23h");
});

test("formatDuration handles days", () => {
  assert.equal(formatDuration(24 * 60), "1d");
  assert.equal(formatDuration(2 * 24 * 60), "2d");
  assert.equal(formatDuration(2 * 24 * 60 + 5 * 60), "2d 5h");
  assert.equal(formatDuration(2 * 24 * 60 + 5 * 60 + 30), "2d 5h 30m");
});

test("formatDuration clamps negatives to 0m", () => {
  assert.equal(formatDuration(-100), "0m");
  assert.equal(formatDuration(NaN), "0m");
  assert.equal(formatDuration(undefined), "0m");
});

// ─── Permission helpers ────────────────────────────────────────────────────

test("canAcceptHandover delegates to canDo('machines','accept')", () => {
  const can = (m, a) => m === "machines" && a === "accept";
  assert.equal(canAcceptHandover(can), true);
  assert.equal(canAcceptHandover((m, a) => m === "machines" && a === "updateStage"), false);
});

test("canFinishTransfer / canConfigureDept guard against missing canDo", () => {
  assert.equal(canFinishTransfer(null), false);
  assert.equal(canFinishTransfer(() => true), true);
  assert.equal(canConfigureDept(null), false);
  assert.equal(canConfigureDept((m, a) => m === "machines" && a === "configDept"), true);
});

// ─── workerIdsOf ───────────────────────────────────────────────────────────
// Regression guard for the 2026-10-29 "Workers · 1" bug: the A-to-Z report and
// the Machine Tracker card both read handover_events.worked_by, a uuid[] that
// by definition cannot hold the "emp:" factory workers, so every man without an
// ERP login vanished from the machine's record.

test("workerIdsOf prefers the snapshot, which is the only complete list", () => {
  const handover = {
    workedBy: ["uuid-head"],                       // uuid[] column: logins only
    workedBySnapshot: [
      { id: "uuid-head", type: "auth", username: "mechanical" },
      { id: "emp:a1", type: "emp", name: "Mahesh Solanki" },
      { id: "emp:b2", type: "emp", name: "Dinesh Chauhan" },
    ],
  };
  assert.deepEqual(workerIdsOf(handover), ["uuid-head", "emp:a1", "emp:b2"]);
});

test("workerIdsOf falls back to the column for pre-snapshot handovers", () => {
  assert.deepEqual(workerIdsOf({ workedBy: ["uuid-a", "uuid-b"] }), ["uuid-a", "uuid-b"]);
  assert.deepEqual(workerIdsOf({ workedBy: ["uuid-a"], workedBySnapshot: [] }), ["uuid-a"]);
});

test("workerIdsOf survives missing, malformed and empty input", () => {
  assert.deepEqual(workerIdsOf(null), []);
  assert.deepEqual(workerIdsOf(undefined), []);
  assert.deepEqual(workerIdsOf({}), []);
  assert.deepEqual(workerIdsOf({ workedBy: null, workedBySnapshot: null }), []);
  assert.deepEqual(workerIdsOf({ workedBy: ["a", null, "b"] }), ["a", "b"]);
  // A snapshot of bare id strings (not objects) is tolerated rather than
  // yielding a list of undefineds that render as blank worker names.
  assert.deepEqual(workerIdsOf({ workedBySnapshot: ["emp:x", "emp:y"] }), ["emp:x", "emp:y"]);
});

test("workerIdsOf keeps the main employee in the list, not separate from it", () => {
  // The UI stars the main employee inside this list, so dropping them here
  // would silently un-name the one person who signed.
  const h = {
    mainEmployeeId: "uuid-head",
    workedBySnapshot: [
      { id: "emp:a1", type: "emp", name: "Ramesh Patel" },
      { id: "uuid-head", type: "auth", username: "assembly" },
    ],
  };
  assert.ok(workerIdsOf(h).includes("uuid-head"));
  assert.equal(workerIdsOf(h).length, 2);
});
