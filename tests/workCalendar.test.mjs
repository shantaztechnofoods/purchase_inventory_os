// Working calendar (2026-10-30): Tuesdays and admin holidays pause every
// department timer and the acceptance timer, and push deadlines out.
process.env.TZ = "Asia/Kolkata";
import test from "node:test";
import assert from "node:assert/strict";
const L = await import("../src/utils/handoverLogic.js");
const { normalizeCalendar, isClosedDay, workingMinutesBetween, addWorkingMinutes,
        computeElapsedMinutes, computeOverrun, isHoldOverdue, heldMinutes,
        readDeptWorkflowSettings, writeDeptWorkflowSettings, setWorkCalendar, DEFAULT_WEEKLY_OFF_DAYS } = L;

const ist = (s) => Date.parse(s + "+05:30");
const cal = normalizeCalendar({ holidays: [{ date: "2026-11-05", name: "Test holiday" }] }); // Tue off + one Thu

test("Tuesday is the default weekly off; holidays normalise and sort", () => {
  assert.deepEqual(DEFAULT_WEEKLY_OFF_DAYS, [2]);
  const c = normalizeCalendar({ weekly_off_days: [2, 2, 9], holidays: ["2026-12-25", { date: "2026-11-05", name: "X" }, "bad"] });
  assert.deepEqual(c.weekly_off_days, [2]);
  assert.deepEqual(c.holidays.map((h) => h.date), ["2026-11-05", "2026-12-25"]);
});

test("closed days: Tuesday 2026-11-03 and the holiday; Monday open", () => {
  assert.equal(isClosedDay(ist("2026-11-03T10:00:00"), cal), true);   // Tuesday
  assert.equal(isClosedDay(ist("2026-11-05T10:00:00"), cal), true);   // holiday
  assert.equal(isClosedDay(ist("2026-11-02T10:00:00"), cal), false);  // Monday
});

test("working minutes skip the whole Tuesday", () => {
  // Mon 18:00 → Wed 10:00 = 40h wall clock; minus 24h Tuesday = 16h
  assert.equal(workingMinutesBetween(ist("2026-11-02T18:00:00"), ist("2026-11-04T10:00:00"), cal), 16 * 60);
  // entirely inside Tuesday → 0
  assert.equal(workingMinutesBetween(ist("2026-11-03T09:00:00"), ist("2026-11-03T18:00:00"), cal), 0);
});

test("a deadline that crosses Tuesday and a holiday is extended by both", () => {
  // Mon 12:00 + 2 working days: Tue off, Wed counts 24h (→ Thu 00:00), Thu = holiday off,
  // Fri 24h → Sat 00:00 ... exactly 2d of open time ends Sat 2026-11-07 12:00? Mon12→Tue00 (12h), Wed 24h, Fri 12h → Fri 12:00
  const start = ist("2026-11-02T12:00:00");
  assert.equal(addWorkingMinutes(start, 2 * 24 * 60, cal), ist("2026-11-06T12:00:00"));
  const r = computeOverrun(new Date(start).toISOString(), 2 * 24 * 60, ist("2026-11-06T11:00:00"), cal);
  assert.equal(r.isOverrun, false);
  assert.equal(r.deadlineMs, ist("2026-11-06T12:00:00"));
  assert.equal(computeOverrun(new Date(start).toISOString(), 2 * 24 * 60, ist("2026-11-06T13:00:00"), cal).overrunMinutes, 60);
});

test("acceptance timer pauses on Tuesday: sent Mon 23:00 with a 2h window is not on hold Tue, is on hold Wed 01:01", () => {
  const sent = new Date(ist("2026-11-02T23:00:00")).toISOString();
  assert.equal(isHoldOverdue(sent, 120, ist("2026-11-03T15:00:00"), cal), false);
  assert.equal(isHoldOverdue(sent, 120, ist("2026-11-04T01:01:00"), cal), true);
  assert.equal(heldMinutes(sent, 120, ist("2026-11-04T01:30:00"), cal), 30);
  assert.equal(computeElapsedMinutes(sent, ist("2026-11-04T01:30:00"), cal), 150);
});

test("settings round-trip keeps the calendar; the module calendar drives the default-argument timers", () => {
  const written = writeDeptWorkflowSettings({}, { dept_durations: {}, accept_timeout_minutes: 120, weekly_off_days: [2], holidays: [{ date: "2026-11-05", name: "Test holiday" }] });
  const read = readDeptWorkflowSettings(written);
  assert.deepEqual(read.weekly_off_days, [2]);
  assert.equal(read.holidays[0].date, "2026-11-05");
  setWorkCalendar(read);
  assert.equal(computeElapsedMinutes(new Date(ist("2026-11-02T18:00:00")).toISOString(), ist("2026-11-04T10:00:00")), 16 * 60);
  setWorkCalendar(null); // restore default (Tuesday only)
});

// App wiring (string checks against the source — the behaviour itself is
// covered above and by the browser run).
import fs from "node:fs"; import path from "node:path";
const app = fs.readFileSync(path.resolve(path.dirname(new URL(import.meta.url).pathname), "../src/App.jsx"), "utf8");
test("app keeps the calendar in sync and uses working time on the acceptance list and card timers", () => {
  assert.match(app, /useEffect\(\(\) => \{ setWorkCalendar\(readDeptWorkflowSettings\(settings\)\); \}, \[settings\]\)/);
  assert.match(app, /const sentMin\s+= computeElapsedMinutes\(h\.sentAt, nowTick\)/);
  assert.match(app, /DELAYED \$\{formatDuration\(t\.overrunMinutes\)\}/);
  assert.match(app, /paused — closed day/);
});
test("admin pull back: admin-only handler, cancelled hand-over kept, history + audit", () => {
  assert.match(app, /Only an admin can pull a hand-over back/);
  assert.match(app, /type: "handover_pulled_back"/);
  assert.match(app, /Pulled back by admin — /);
});
test("on-hold acceptance needs a reason that goes into history and audit", () => {
  assert.match(app, /This machine is ON HOLD — write why it is being accepted late/);
  assert.match(app, /ON HOLD — accepted late/);
  assert.match(app, /holdReason: holdReason \|\| undefined/);
});
test("reports: pilot records excluded by default, language table covers the three languages", () => {
  assert.match(app, /const isTestRecord = \(m\) => \/\^\(TEST\|PILOT\)/);
  assert.match(app, /rc\.includeTestRecords \|\| !isTestRecord\(m\)/);
  assert.match(app, /REPORT_LANGS = \[\["en", "English"\], \["hinglish", "Hinglish"\], \["gujlish", "Gujlish"\]\]/);
});
