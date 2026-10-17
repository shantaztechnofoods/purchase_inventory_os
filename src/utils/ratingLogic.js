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
