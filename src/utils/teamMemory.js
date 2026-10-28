// Remember which people worked in a department, so the floor stops re-picking
// the same crew every single time.
//
// The problem this solves: openFinishModal started with `workedBy: []` and
// openAcceptModal with `acceptTeamMembers: []`, every time, forever. But the
// same two or three fitters work in Mechanical every day. Re-selecting them on
// a tablet, per machine, per handover, is pure repetition with no information
// in it.
//
// Where it is stored and why: localStorage, per department, per device. That is
// deliberately NOT the database. The remembered crew is a property of the
// tablet standing in that department — the Mechanical tablet should remember
// Mechanical's crew — not a property of the company that every other screen
// must agree about. It also means a wrong guess costs nothing: it is a
// pre-selection the operator can change in one tap, never a stored fact, and
// it is never written into a handover record. What IS written into the record
// is only ever what the operator confirmed on screen.
//
// Two shapes are remembered because the two modals speak different languages:
//   finish  → worker ids   ("<uuid>" for ERP logins, "emp:<id>" for factory workers)
//   accept  → worker names (plain strings, from settings.employeeMembers)
// reconcileTeam handles both; it only ever compares and filters, never parses.

const KEY_PREFIX = "erp_team_memory";

// ─── Pure core (unit-tested) ────────────────────────────────────────────────

// Keep only remembered members who are still eligible today, in the order they
// were remembered.
//
// The filter is the whole point. A fitter who left the company, moved
// department, or was deactivated in Settings must NOT reappear pre-ticked on a
// handover three months later — that would be the ERP asserting someone worked
// on a machine when nobody said so. Anything not in the current eligible pool
// is dropped silently; the operator simply sees a shorter pre-selection.
export function reconcileTeam(remembered, eligible) {
  if (!Array.isArray(remembered) || !Array.isArray(eligible)) return [];
  const allowed = new Set(eligible.filter((x) => x != null).map(String));
  const seen = new Set();
  const out = [];
  for (const r of remembered) {
    if (r == null) continue;
    const k = String(r);
    if (!allowed.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

// Which remembered person should be pre-set as Main Employee.
//
// Constraints, all of them load-bearing:
//   - must still be in the reconciled team (so it survived the filter above)
//   - must be an ERP login, never an "emp:" factory worker, because Main
//     Employee signs the handover and only logins have a stored signature
//   - returns null rather than guessing when the remembered main is gone;
//     the existing addWorker auto-pick then does its normal job
//
// It returns the element **from `team`**, not the value read out of storage,
// even though they compare equal as strings. Finish & Transfer gates on
// `workedBy.includes(mainEmployeeId)`, which is strict: a remembered `"7"`
// against a team holding `7` would pass this check and then fail that one,
// and the operator would be told "Main Employee required" about somebody
// already ticked on screen. Returning the team's own value keeps the two
// checks agreeing.
//
// The signature itself is never remembered. mainSigSvg stays null and the pad
// is shown as usual — a pre-filled signature would be a forgery.
export function pickRememberedMain(team, rememberedMainId) {
  if (!rememberedMainId || !Array.isArray(team)) return null;
  const id = String(rememberedMainId);
  if (id.startsWith("emp:")) return null;
  const match = team.find((t) => String(t) === id);
  return match === undefined ? null : match;
}

// ─── localStorage wrapper ───────────────────────────────────────────────────
// Every access is wrapped: localStorage throws in private windows and when
// site data is blocked, and this is a convenience, not data. It must never be
// the reason a handover modal fails to open.

function keyFor(scope, department) {
  return `${KEY_PREFIX}:${scope}:${department || "_"}`;
}

export function readTeamMemory(scope, department) {
  if (!department) return { members: [], mainId: null };
  try {
    const raw = localStorage.getItem(keyFor(scope, department));
    if (!raw) return { members: [], mainId: null };
    const parsed = JSON.parse(raw);
    return {
      members: Array.isArray(parsed?.members) ? parsed.members : [],
      mainId:  parsed?.mainId ?? null,
    };
  } catch {
    return { members: [], mainId: null };
  }
}

export function writeTeamMemory(scope, department, members, mainId = null) {
  if (!department) return;
  try {
    const list = Array.isArray(members) ? members.filter((x) => x != null) : [];
    // Nothing confirmed means nothing to remember. Don't overwrite a good
    // memory with an empty one just because this handover had no crew picked.
    if (list.length === 0) return;
    localStorage.setItem(keyFor(scope, department), JSON.stringify({ members: list, mainId: mainId ?? null }));
  } catch {
    // ignore — see note above
  }
}
