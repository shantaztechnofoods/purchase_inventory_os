// Department performance rating formula + pure helpers.
//
// Documented, consistent rule (also described in migration 025 header):
//
//   base                   = 5 stars
//   − 1 star  if handover.overrunMinutes > 0  (finish-transfer late vs config)
//   − 1 star  if handover held past accept_timeout before accept
//   − 1 star  if machine still has unresolved pending_handover_items
//
// Clamp to [0, 5]. The function returns both the final rating AND the
// deductions log so the UI can show "4★ — overrun 2h · pending items: 1".

export function computeDepartmentRating({
  overrunMinutes = 0,
  heldMinutes    = 0,
  pendingItemsOpen = 0,
} = {}) {
  const deductions = [];
  const base = 5;
  let value = base;
  if (Number(overrunMinutes) > 0) {
    value -= 1;
    deductions.push({ reason: "overrun_at_finish", points: 1, metric: Number(overrunMinutes) });
  }
  if (Number(heldMinutes) > 0) {
    value -= 1;
    deductions.push({ reason: "held_before_accept", points: 1, metric: Number(heldMinutes) });
  }
  if (Number(pendingItemsOpen) > 0) {
    value -= 1;
    deductions.push({ reason: "pending_items_open", points: 1, metric: Number(pendingItemsOpen) });
  }
  value = Math.max(0, Math.min(5, value));
  return {
    rating: value,
    base,
    deductions,
    final: value,
    inputs: { overrunMinutes: Number(overrunMinutes), heldMinutes: Number(heldMinutes), pendingItemsOpen: Number(pendingItemsOpen) },
  };
}

// Short human string. Used in Factory report and Machine card badges.
export function formatRatingBadge(rating) {
  const r = Math.max(0, Math.min(5, Math.floor(Number(rating) || 0)));
  return "★".repeat(r) + "☆".repeat(5 - r);
}

// Reduce an array of per-department ratings → a single machine summary.
export function summarizeMachineRatings(ratings = []) {
  if (!Array.isArray(ratings) || ratings.length === 0) {
    return { count: 0, average: null, perDept: {} };
  }
  const perDept = {};
  let sum = 0;
  for (const r of ratings) {
    const v = Math.max(0, Math.min(5, Math.floor(Number(r?.rating) || 0)));
    sum += v;
    const dept = r?.department || "unknown";
    // Keep the latest row per department. Preference order:
    //   (a) higher id, (b) later createdAt. First seen wins when both missing.
    const prev = perDept[dept];
    const rid = r?.id;
    const rts = r?.createdAt;
    const takeNew = !prev
      || (rid != null && prev.id != null && rid > prev.id)
      || (rid != null && prev.id == null)
      || (rid == null && prev.id == null && rts && (!prev.createdAt || rts > prev.createdAt));
    if (takeNew) {
      perDept[dept] = { rating: v, overridden: !!r?.overriddenBy, id: rid ?? null, createdAt: rts ?? null };
    }
  }
  // Strip internal bookkeeping before returning.
  for (const k of Object.keys(perDept)) {
    const { rating, overridden } = perDept[k];
    perDept[k] = { rating, overridden };
  }
  return {
    count: ratings.length,
    average: Math.round((sum / ratings.length) * 10) / 10,
    perDept,
  };
}

// ── Department scoreboard ────────────────────────────────────────────────────
// "Where it sticks" used to be four CSV-shaped tables. Every number was in
// there, but nobody could answer the question the tab is named after without
// reading all four and doing the arithmetic in their head.
//
// This is the answer instead: one row per department, worst first. Each row is
// built from the handovers that department SENT, which is the work it owns —
// how often it finished inside its allowance, how far over it ran when it
// didn't, how long the next department left it waiting, and the stars it was
// given. Sorting by score puts the department that needs attention at the top.
// Stages that are not departments. A machine passes through "BOM Issued" and
// ends at "Ready", but neither has people, a clock or a rating — scoring them
// would put two permanently empty rows at the top of the table.
const NON_WORKING_STAGES = new Set(["BOM Issued", "Ready"]);

export function buildDepartmentScoreboard(handovers = [], ratings = []) {
  const byDept = new Map();

  const row = (dept) => {
    if (NON_WORKING_STAGES.has(dept)) return null;
    if (!byDept.has(dept)) {
      byDept.set(dept, {
        department: dept, handovers: 0, onTime: 0, overran: 0,
        overrunMinutes: 0, heldMinutes: 0, heldCount: 0,
        ratingSum: 0, ratingCount: 0, openIssues: 0,
      });
    }
    return byDept.get(dept);
  };

  for (const h of handovers) {
    if (!h || !h.fromDepartment) continue;
    const r = row(h.fromDepartment);
    if (r) {
      r.handovers += 1;
      const over = Number(h.overrunMinutes) || 0;
      if (over > 0) { r.overran += 1; r.overrunMinutes += over; } else { r.onTime += 1; }
    }

    // The receiving department gets a row whether or not it was late. A
    // department that has taken work in and handed none of it on yet is
    // precisely the answer to "where is it stuck", so it must be visible —
    // with zeros, not absent.
    if (h.toDepartment) {
      const rec = row(h.toDepartment);
      if (!rec) continue;
      // How long it sat past the accept window. Charged to the receiver, not
      // the sender: finishing on time and then being left waiting is not the
      // sender's fault. A handover never accepted is still waiting, so its
      // clock runs to now.
      if (h.sentAt) {
        const until = h.acceptedAt ? Date.parse(h.acceptedAt) : Date.now();
        const waited = Math.max(0, Math.floor((until - Date.parse(h.sentAt)) / 60000));
        const held = Math.max(0, waited - (Number(h.acceptTimeoutMinutes) || 0));
        if (held > 0) {
          rec.heldMinutes += held;
          rec.heldCount += 1;
        }
      }
    }
  }

  for (const rt of ratings) {
    if (!rt || !rt.department) continue;
    const n = Number(rt.rating);
    if (!Number.isFinite(n)) continue;
    const r = row(rt.department);
    if (!r) continue;
    r.ratingSum += n;
    r.ratingCount += 1;
  }

  return [...byDept.values()]
    .map((r) => ({
      ...r,
      onTimePct: r.handovers ? Math.round((r.onTime / r.handovers) * 100) : null,
      avgOverrun: r.overran ? Math.round(r.overrunMinutes / r.overran) : 0,
      avgHeld: r.heldCount ? Math.round(r.heldMinutes / r.heldCount) : 0,
      avgRating: r.ratingCount ? Math.round((r.ratingSum / r.ratingCount) * 10) / 10 : null,
    }))
    // Worst first: lowest rating, then worst on-time record. Departments with
    // no rating yet sort to the bottom rather than to the top as a false 0 —
    // "no data" is not "bad".
    .sort((a, b) => {
      if (a.avgRating === null && b.avgRating !== null) return 1;
      if (b.avgRating === null && a.avgRating !== null) return -1;
      if (a.avgRating !== b.avgRating) return (a.avgRating ?? 0) - (b.avgRating ?? 0);
      return (a.onTimePct ?? 0) - (b.onTimePct ?? 0);
    });
}
