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
export const DEFAULT_ACCEPT_TIMEOUT_MINUTES = 120; // 2 hours
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
  return {
    dept_durations: durations,
    accept_timeout_minutes: timeout,
    require_password_at_accept: requirePwd,
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
  return {
    ...(prev || {}),
    department_workflow: {
      dept_durations,
      accept_timeout_minutes,
      require_password_at_accept,
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
export function computeElapsedMinutes(enteredAtIso, nowMs = Date.now()) {
  if (!enteredAtIso) return 0;
  const t = typeof enteredAtIso === "number" ? enteredAtIso : Date.parse(enteredAtIso);
  if (!Number.isFinite(t)) return 0;
  const diffMs = nowMs - t;
  if (diffMs <= 0) return 0;
  return Math.floor(diffMs / 60000);
}

// Overrun = max(0, elapsed - expected). isOverrun true means the Finish &
// Transfer modal MUST require a non-empty narration before commit.
export function computeOverrun(enteredAtIso, expectedMinutes, nowMs = Date.now()) {
  const actualMinutes = computeElapsedMinutes(enteredAtIso, nowMs);
  const expected = Math.max(0, Math.floor(Number(expectedMinutes) || 0));
  const overrunMinutes = Math.max(0, actualMinutes - expected);
  return { actualMinutes, expectedMinutes: expected, overrunMinutes, isOverrun: overrunMinutes > 0 };
}

// HOLD detection: a handover is "overdue" when it has been pending for longer
// than the (snapshot) accept-timeout. Phase A never writes status='held' —
// this returns a boolean the UI consumes on every render.
export function isHoldOverdue(sentAtIso, acceptTimeoutMinutes, nowMs = Date.now()) {
  if (!sentAtIso) return false;
  const t = typeof sentAtIso === "number" ? sentAtIso : Date.parse(sentAtIso);
  if (!Number.isFinite(t)) return false;
  const timeout = Math.max(0, Math.floor(Number(acceptTimeoutMinutes) || 0));
  const diffMinutes = (nowMs - t) / 60000;
  return diffMinutes > timeout;
}

// How much the handover has exceeded the accept-timeout (minutes). Zero when
// not overdue. Used in reports to show "held for 1h 14m".
export function heldMinutes(sentAtIso, acceptTimeoutMinutes, nowMs = Date.now()) {
  if (!isHoldOverdue(sentAtIso, acceptTimeoutMinutes, nowMs)) return 0;
  const t = typeof sentAtIso === "number" ? sentAtIso : Date.parse(sentAtIso);
  const diffMinutes = Math.floor((nowMs - t) / 60000);
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
