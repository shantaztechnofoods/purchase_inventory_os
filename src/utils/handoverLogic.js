// Pure helpers for the Department Workflow Phase A handover model.
// Zero React / zero DOM — everything here is testable in Node via node:test.

// Ordered stage sequence. Mirrors src/App.jsx MACHINE_STAGES exactly; kept
// here so unit tests don't need to import App.jsx (which pulls React).
export const DEPARTMENT_SEQUENCE = Object.freeze([
  "BOM Issued",
  "Assembly",
  "Mechanical",
  "Electrical",
  "Trial",
  "Ready",
]);

// Default per-department work-duration config. Applied when settings.department_workflow
// is absent (first boot, or admin hasn't opened Settings yet). Values in minutes so all
// arithmetic is boring; the UI renders as "2 days" / "8 hours" based on magnitude.
export const DEFAULT_DEPT_DURATIONS = Object.freeze({
  "Assembly":   { minutes: 2 * 24 * 60 },  // 2 days
  "Mechanical": { minutes: 2 * 24 * 60 },  // 2 days
  "Electrical": { minutes: 1 * 24 * 60 },  // 1 day
  "Trial":      { minutes: 8 * 60 },        // 8 hours
});
// Migration 036 — the hops where the machine waits on the rack instead of
// being pushed straight to the next department.
//
// Shantaz runs a pull system at exactly one point in the line: Assembly takes
// material off the rack, assembles it, and puts the machine BACK on the rack,
// where seven or eight wait at a time. Mechanical starts on one only when the
// production head says so. Every later hop is a direct handover, where the
// acceptance deadline is real and a late accept is worth flagging.
export const RACK_RELEASE_HOPS = Object.freeze([
  Object.freeze({ from: "Assembly", to: "Mechanical" }),
]);

export function isRackReleaseHop(fromDepartment, toDepartment) {
  return RACK_RELEASE_HOPS.some((h) => h.from === fromDepartment && h.to === toDepartment);
}

export const DEFAULT_ACCEPT_TIMEOUT_MINUTES = 120; // 2 hours

// ── Working calendar (2026-10-30) ──────────────────────────────────────────
// The factory is closed every Tuesday and on admin-configured holidays. Time
// on a closed day does not count: department work timers and the acceptance
// timer pause, so every deadline moves out by the closed time. Days are local
// calendar days (the ERP runs in IST). weekly_off_days uses JS getDay()
// numbering: 0 = Sunday … 2 = Tuesday … 6 = Saturday.
export const DEFAULT_WEEKLY_OFF_DAYS = Object.freeze([2]); // Tuesday
const pad2 = (n) => String(n).padStart(2, "0");
export function localDateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
export function normalizeCalendar(raw) {
  const off = Array.isArray(raw?.weekly_off_days) ? raw.weekly_off_days : DEFAULT_WEEKLY_OFF_DAYS;
  const weekly_off_days = [...new Set(off.map((n) => Math.floor(Number(n))).filter((n) => n >= 0 && n <= 6))].sort();
  const holidays = (Array.isArray(raw?.holidays) ? raw.holidays : [])
    .map((h) => (typeof h === "string" ? { date: h, name: "" } : { date: String(h?.date || ""), name: String(h?.name || "") }))
    .filter((h) => /^\d{4}-\d{2}-\d{2}$/.test(h.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { weekly_off_days, holidays };
}
// Module-level calendar used by every timer below. App sets it from settings
// on load and whenever settings change; tests may pass a calendar directly.
let ACTIVE_CALENDAR = normalizeCalendar(null);
export function setWorkCalendar(raw) { ACTIVE_CALENDAR = normalizeCalendar(raw); return ACTIVE_CALENDAR; }
export function getWorkCalendar() { return ACTIVE_CALENDAR; }
export function isClosedDay(ms, calendar = ACTIVE_CALENDAR) {
  const d = new Date(ms);
  if (calendar.weekly_off_days.includes(d.getDay())) return true;
  const key = localDateKey(ms);
  return calendar.holidays.some((h) => h.date === key);
}
// Minutes between two instants that fall on open (working) days.
export function workingMinutesBetween(startMs, endMs, calendar = ACTIVE_CALENDAR) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
  let total = 0;
  let cur = startMs;
  let guard = 0;
  while (cur < endMs && guard++ < 4000) {            // ~11 years of days; plenty
    const d = new Date(cur);
    const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const segEnd = Math.min(endMs, nextMidnight);
    if (!isClosedDay(cur, calendar)) total += segEnd - cur;
    cur = segEnd;
  }
  return Math.floor(total / 60000);
}
// The instant at which `minutes` of working time have passed after start —
// i.e. a deadline extended over every closed day it crosses.
export function addWorkingMinutes(startMs, minutes, calendar = ACTIVE_CALENDAR) {
  let left = Math.max(0, Number(minutes) || 0) * 60000;
  let cur = startMs;
  let guard = 0;
  while (guard++ < 4000) {
    const d = new Date(cur);
    const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    if (isClosedDay(cur, calendar)) { cur = nextMidnight; continue; }
    const room = nextMidnight - cur;
    if (left <= room) return cur + left;
    left -= room; cur = nextMidnight;
  }
  return cur;
}
// Password re-auth at Accept is OFF by default per 2026-10-19 UX pass:
// routine machine acceptance should be a single-click confirmation for
// non-technical operators. Authenticated session + role check + saved
// signature + audit log remain the proof chain. Admins can re-enable
// via the Department Workflow Settings toggle.
export const DEFAULT_REQUIRE_PASSWORD_AT_ACCEPT = false;

// Settings shape for the JSONB key. Merged against defaults on read so new
// departments added in the future don't break historical rows.
export function readDeptWorkflowSettings(settings) {
  const raw = (settings && settings.department_workflow) || {};
  const durations = { ...DEFAULT_DEPT_DURATIONS, ...(raw.dept_durations || {}) };
  const timeout   = Number.isFinite(raw.accept_timeout_minutes) && raw.accept_timeout_minutes >= 0
    ? raw.accept_timeout_minutes
    : DEFAULT_ACCEPT_TIMEOUT_MINUTES;
  const requirePwd = typeof raw.require_password_at_accept === "boolean"
    ? raw.require_password_at_accept
    : DEFAULT_REQUIRE_PASSWORD_AT_ACCEPT;
  const cal = normalizeCalendar(raw);
  return {
    dept_durations: durations,
    accept_timeout_minutes: timeout,
    require_password_at_accept: requirePwd,
    weekly_off_days: cal.weekly_off_days,
    holidays: cal.holidays,
  };
}

export function writeDeptWorkflowSettings(prev, next) {
  // Minimal normalization: integers only, clamp negatives to 0.
  const dept_durations = {};
  for (const [dept, cfg] of Object.entries(next.dept_durations || {})) {
    const m = Math.max(0, Math.floor(Number(cfg.minutes) || 0));
    dept_durations[dept] = { minutes: m };
  }
  const accept_timeout_minutes = Math.max(0, Math.floor(Number(next.accept_timeout_minutes) || 0));
  const require_password_at_accept = next.require_password_at_accept === true;
  // Keep the working calendar (2026-10-30); fall back to what was saved.
  const prevWf = (prev && prev.department_workflow) || {};
  const cal = normalizeCalendar({
    weekly_off_days: next.weekly_off_days ?? prevWf.weekly_off_days,
    holidays: next.holidays ?? prevWf.holidays,
  });
  return {
    ...(prev || {}),
    department_workflow: {
      dept_durations,
      accept_timeout_minutes,
      require_password_at_accept,
      weekly_off_days: cal.weekly_off_days,
      holidays: cal.holidays,
    },
  };
}

// nextDepartment("Mechanical") → "Electrical"
// nextDepartment("Trial")      → "Ready"
// nextDepartment("Ready")      → null   (terminal state; no further transfer)
// nextDepartment("BOM Issued") → null   (BOM Issued transitions via Start
//                                        Production, not Finish & Transfer —
//                                        same decision as design doc §12.6)
export function nextDepartment(current) {
  if (current === "BOM Issued" || current === "Ready") return null;
  const i = DEPARTMENT_SEQUENCE.indexOf(current);
  if (i < 0) return null;
  return DEPARTMENT_SEQUENCE[i + 1] || null;
}

// Elapsed-time in current department, in minutes. Treats missing enteredAt
// as 0 so partially-backfilled rows don't crash the UI.
// 2026-10-30 — working minutes only: Tuesdays and holidays pause the timer.
export function computeElapsedMinutes(enteredAtIso, nowMs = Date.now(), calendar = ACTIVE_CALENDAR) {
  if (!enteredAtIso) return 0;
  const t = typeof enteredAtIso === "number" ? enteredAtIso : Date.parse(enteredAtIso);
  if (!Number.isFinite(t)) return 0;
  if (nowMs - t <= 0) return 0;
  return workingMinutesBetween(t, nowMs, calendar);
}

// Overrun = max(0, elapsed - expected). isOverrun true means the Finish &
// Transfer modal MUST require a non-empty narration before commit.
export function computeOverrun(enteredAtIso, expectedMinutes, nowMs = Date.now(), calendar = ACTIVE_CALENDAR) {
  const actualMinutes = computeElapsedMinutes(enteredAtIso, nowMs, calendar);
  const expected = Math.max(0, Math.floor(Number(expectedMinutes) || 0));
  const overrunMinutes = Math.max(0, actualMinutes - expected);
  // Target deadline, extended over every closed day it crosses.
  const t = enteredAtIso ? (typeof enteredAtIso === "number" ? enteredAtIso : Date.parse(enteredAtIso)) : NaN;
  const deadlineMs = Number.isFinite(t) ? addWorkingMinutes(t, expected, calendar) : null;
  return { actualMinutes, expectedMinutes: expected, overrunMinutes, isOverrun: overrunMinutes > 0, deadlineMs };
}

// HOLD detection: a handover is "overdue" when it has been pending for longer
// than the (snapshot) accept-timeout. Phase A never writes status='held' —
// this returns a boolean the UI consumes on every render.
// 2026-10-30 — the acceptance timer also pauses on Tuesdays and holidays.
export function isHoldOverdue(sentAtIso, acceptTimeoutMinutes, nowMs = Date.now(), calendar = ACTIVE_CALENDAR) {
  if (!sentAtIso) return false;
  const t = typeof sentAtIso === "number" ? sentAtIso : Date.parse(sentAtIso);
  if (!Number.isFinite(t)) return false;
  const timeout = Math.max(0, Math.floor(Number(acceptTimeoutMinutes) || 0));
  return workingMinutesBetween(t, nowMs, calendar) > timeout;
}

// How much the handover has exceeded the accept-timeout (minutes). Zero when
// not overdue. Used in reports to show "held for 1h 14m".
export function heldMinutes(sentAtIso, acceptTimeoutMinutes, nowMs = Date.now(), calendar = ACTIVE_CALENDAR) {
  if (!isHoldOverdue(sentAtIso, acceptTimeoutMinutes, nowMs, calendar)) return 0;
  const t = typeof sentAtIso === "number" ? sentAtIso : Date.parse(sentAtIso);
  const diffMinutes = workingMinutesBetween(t, nowMs, calendar);
  const timeout = Math.max(0, Math.floor(Number(acceptTimeoutMinutes) || 0));
  return Math.max(0, diffMinutes - timeout);
}

// "90 min" → "1h 30m". "2880 min" → "2d". Format matches the Settings UI
// rendering of per-department durations.
export function formatDuration(minutes) {
  const m = Math.max(0, Math.floor(Number(minutes) || 0));
  if (m === 0) return "0m";
  if (m < 60) return `${m}m`;
  const hours = Math.floor(m / 60);
  const remMin = m % 60;
  if (hours < 24) {
    return remMin ? `${hours}h ${remMin}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  if (!remHours && !remMin) return `${days}d`;
  if (!remMin) return `${days}d ${remHours}h`;
  return `${days}d ${remHours}h ${remMin}m`;
}

// Everyone who worked on a handover, in display order.
//
// Two fields hold this, and only one of them is complete. `worked_by` is a
// Postgres uuid[], so it can only ever contain ERP logins; Finish & Transfer
// filters the "emp:" factory workers out of it and writes the full list — logins
// and factory workers together — to `worked_by_snapshot`. Read the column and a
// machine built by a department head and two fitters reports one worker.
//
// The snapshot wins whenever it exists. The column is the fallback for handovers
// recorded before snapshots were introduced, where it is the only record there is.
export function workerIdsOf(handover) {
  if (!handover) return [];
  const snap = handover.workedBySnapshot;
  if (Array.isArray(snap) && snap.length > 0) {
    return snap.map((w) => (w && w.id ? w.id : w)).filter(Boolean);
  }
  return Array.isArray(handover.workedBy) ? handover.workedBy.filter(Boolean) : [];
}

// Does this user have the receiving-department role for the given to_department?
// Phase A policy: anyone with canDo("machines","updateStage") can accept — the
// existing permission is auto-mapped (design doc §5.5 / §12.2). A future phase
// can tighten this to a per-dept canDo if roles become dept-tagged.
export function canAcceptHandover(canDoFn /* (module, action) => bool */, _toDepartment) {
  if (typeof canDoFn !== "function") return false;
  return !!canDoFn("machines", "accept");
}

// Finish & Transfer gate. Same mapping: canDo("machines","finishTransfer").
export function canFinishTransfer(canDoFn /* (module, action) => bool */) {
  if (typeof canDoFn !== "function") return false;
  return !!canDoFn("machines", "finishTransfer");
}

// Admin check for Settings → Department Workflow section.
export function canConfigureDept(canDoFn) {
  if (typeof canDoFn !== "function") return false;
  return !!canDoFn("machines", "configDept");
}
