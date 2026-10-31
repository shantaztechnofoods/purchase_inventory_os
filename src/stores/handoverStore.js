// Handover-events store — public.handover_events
//
// Same gating pattern as src/stores/posStore.js:
//   isSupabaseEnabled() === false → operate on localStorage only.
//   getSupabase() === null         → silent fallback to local.
//   RLS enforces security server-side; this file just maps shapes.
//
// See docs/department-workflow-phase-a.md for the field semantics.

import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

const LOCAL_KEY = "erp_handovers";

function toRow(h) {
  const row = {
    machine_id:                h.machineId,
    bom_key:                   h.bomKey,
    serial_no:                 h.serialNo || null,
    from_department:           h.fromDepartment,
    to_department:             h.toDepartment,
    sent_by:                   h.sentBy || null,
    sent_by_signature_id:      h.sentBySignatureId || null,
    expected_duration_minutes: Math.max(0, Math.floor(Number(h.expectedDurationMinutes) || 0)),
    actual_duration_minutes:   Math.max(0, Math.floor(Number(h.actualDurationMinutes)   || 0)),
    overrun_narration:         h.overrunNarration || null,
    accept_timeout_minutes:    Math.max(0, Math.floor(Number(h.acceptTimeoutMinutes)    || 0)),
    status:                    h.status || "pending",
  };
  // Migration 029 — department-wise employees + Main Employee signature.
  // Only attach when the caller supplied them so the isMissingColumnError
  // retry in createHandover can strip them for pre-029 schemas.
  if (h.workedBy                  !== undefined) row.worked_by                   = Array.isArray(h.workedBy) ? h.workedBy : null;
  if (h.workedBySnapshot          !== undefined) row.worked_by_snapshot          = h.workedBySnapshot || null;
  if (h.mainEmployeeId            !== undefined) row.main_employee_id            = h.mainEmployeeId || null;
  // Migration 050 — Main Employee without an ERP login.
  if (h.mainEmployeeRef           !== undefined) row.main_employee_ref           = h.mainEmployeeRef || null;
  if (h.mainEmployeeName          !== undefined) row.main_employee_name          = h.mainEmployeeName || null;
  if (h.mainEmployeeSignatureId   !== undefined) row.main_employee_signature_id  = h.mainEmployeeSignatureId || null;
  if (h.mainEmployeeSignatureSvg  !== undefined) row.main_employee_signature_svg = h.mainEmployeeSignatureSvg || null;
  // Migration 036 — a handover parked on the rack until a production head
  // releases it. Same strip-on-retry treatment for pre-036 schemas.
  if (h.releaseRequired           !== undefined) row.release_required           = !!h.releaseRequired;
  return row;
}
function fromRow(r) {
  return {
    id:                        r.id,
    machineId:                 r.machine_id,
    bomKey:                    r.bom_key,
    serialNo:                  r.serial_no || "",
    fromDepartment:            r.from_department,
    toDepartment:              r.to_department,
    sentBy:                    r.sent_by || null,
    sentBySignatureId:         r.sent_by_signature_id || null,
    sentAt:                    r.sent_at || null,
    // Migration 036 — rack release. Pre-036 rows read as a straight push.
    releaseRequired:           r.release_required === true,
    releasedAt:                r.released_at || null,
    releasedBy:                r.released_by || null,
    expectedDurationMinutes:   Number(r.expected_duration_minutes) || 0,
    actualDurationMinutes:     Number(r.actual_duration_minutes)   || 0,
    overrunMinutes:            Number(r.overrun_minutes)           || 0,  // generated col
    overrunNarration:          r.overrun_narration || "",
    acceptedBy:                r.accepted_by || null,
    acceptedBySignatureId:     r.accepted_by_signature_id || null,
    acceptedAt:                r.accepted_at || null,
    status:                    r.status,
    cancelledAt:               r.cancelled_at || null,
    cancellationReason:        r.cancellation_reason || "",
    acceptTimeoutMinutes:      Number(r.accept_timeout_minutes) || 0,
    createdAt:                 r.created_at || null,
    // Migration 029 — department-wise employees + Main Employee signature.
    // Nullable for legacy rows (pre-029 handovers have none of these).
    workedBy:                  Array.isArray(r.worked_by) ? r.worked_by : null,
    workedBySnapshot:          Array.isArray(r.worked_by_snapshot) ? r.worked_by_snapshot : null,
    mainEmployeeId:            r.main_employee_id || null,
    mainEmployeeRef:           r.main_employee_ref || null,
    mainEmployeeName:          r.main_employee_name || null,
    mainEmployeeSignatureId:   r.main_employee_signature_id || null,
    mainEmployeeSignatureSvg:  r.main_employee_signature_svg || null,
    // Migration 031 — accept-side team snapshot (nullable for legacy rows).
    acceptedByTeamSnapshot:    Array.isArray(r.accepted_by_team_snapshot) ? r.accepted_by_team_snapshot : null,
  };
}

// Detects "column does not exist" / schema-cache errors so createHandover
// can retry without the migration-029 columns if the schema isn't migrated
// yet. Same pattern as itemsStore / machinesStore / checklistsStore.
function isMissingColumnError(err) {
  if (!err) return false;
  if (err.code === "42703" || err.code === "PGRST204") return true;
  return /column .* does not exist|schema cache|could not find the .* column/i.test(err.message || err.details || err.hint || "");
}

function getLocal() { try { const s = localStorage.getItem(LOCAL_KEY); if (s) return JSON.parse(s); } catch {} return []; }
function setLocal(a) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(a)); } catch {} }

// Returns all handovers, newest-first.
// Migration 036 — a production head releases a machine from the rack to the
// department waiting for it. Only ever moves a handover forward: the guard on
// released_at makes a second click a no-op rather than a second release.
export async function releaseHandover(id, { releasedBy }) {
  const stamp = new Date().toISOString();
  if (!isSupabaseEnabled()) {
    const all = getLocal().map((h) => h.id === id && !h.releasedAt
      ? { ...h, releasedAt: stamp, releasedBy: releasedBy || null }
      : h);
    setLocal(all);
    return { success: true, handover: all.find((h) => h.id === id) || null };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { data, error } = await c.from("handover_events")
    .update({ released_at: stamp, released_by: releasedBy || null })
    .eq("id", id).eq("status", "pending").is("released_at", null)
    .select().maybeSingle();
  if (error) {
    console.error("[handovers:release] failed", error);
    if (isMissingColumnError(error)) {
      return { success: false, error: "Rack release needs migration 036. Ask an admin to apply it." };
    }
    return { success: false, error: error.message };
  }
  if (!data) return { success: false, error: "Already released, or no longer waiting." };
  return { success: true, handover: fromRow(data) };
}

export async function fetchHandovers() {
  const mode = isSupabaseEnabled() ? "SUPABASE" : "LOCAL";
  console.info("[handovers:load] start", { mode });
  if (!isSupabaseEnabled()) { const a = getLocal(); console.info("[handovers:load] local ok", { count: a.length }); return a; }
  const c = getSupabase(); if (!c) return getLocal();
  const { data, error } = await c
    .from("handover_events")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) { console.error("[handovers:load] failed", error); return getLocal(); }
  const out = (data || []).map(fromRow);
  setLocal(out);
  console.info("[handovers:load] supabase ok", { count: out.length });
  return out;
}

// Convenience: pending handovers only. Used to render the Machine Tracker
// "awaiting acceptance" banner without pulling the full history.
export async function fetchPendingHandovers() {
  const all = await fetchHandovers();
  return all.filter((h) => h.status === "pending");
}

export async function createHandover(h) {
  console.info("[handovers:create] start", { machineId: h.machineId, from: h.fromDepartment, to: h.toDepartment, overrun: h.overrunNarration ? "yes" : "no" });
  if (!isSupabaseEnabled()) {
    // Local-mode: fabricate id + sent_at so the UI sees a complete object.
    const row = {
      id: Date.now(),
      sent_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      overrun_minutes: Math.max(0, (h.actualDurationMinutes || 0) - (h.expectedDurationMinutes || 0)),
      ...toRow(h),
    };
    setLocal([fromRow(row), ...getLocal()]);
    return { success: true, handover: fromRow(row) };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const fullRow = toRow(h);
  let { data, error } = await c
    .from("handover_events")
    .insert(fullRow)
    .select()
    .single();
  // Migration 029 — retry without the new columns when the schema hasn't
  // been migrated yet. Keeps the create path working against pre-029 DBs.
  if (error && isMissingColumnError(error)) {
    console.warn("[handovers:create] migration 029/036 columns missing — retrying without them");
    const slim = { ...fullRow };
    delete slim.worked_by;
    delete slim.worked_by_snapshot;
    delete slim.main_employee_id;
    delete slim.main_employee_ref;
    delete slim.main_employee_name;
    delete slim.main_employee_signature_id;
    delete slim.main_employee_signature_svg;
    // Migration 036. Dropping it means the handover becomes a straight push:
    // safe, just not the rack behaviour, until the migration is applied.
    delete slim.release_required;
    ({ data, error } = await c.from("handover_events").insert(slim).select().single());
  }
  if (error) {
    console.error("[handovers:create] failed", error);
    // Specific CHECK-constraint hints
    const msg = String(error.message || "");
    if (/handover_narration_when_over/i.test(msg)) {
      return { success: false, error: "Narration required when work time exceeds the configured duration." };
    }
    if (/handover_dept_different/i.test(msg)) {
      return { success: false, error: "From and To departments must differ." };
    }
    if (/handover_main_in_worked/i.test(msg)) {
      return { success: false, error: "Main Employee must be one of the selected workers." };
    }
    return { success: false, error: error.message };
  }
  const out = fromRow(data);
  console.info("[handovers:create] ok", { id: out.id });
  return { success: true, handover: out };
}

// Accept transitions status 'pending' → 'accepted' atomically.
// The WHERE status = 'pending' makes it race-safe: a second accept returns
// zero rows and the UI reads the latest state.
export async function acceptHandover(id, { acceptedBy, acceptedBySignatureId, acceptedByTeamSnapshot = null }) {
  console.info("[handovers:accept] start", { id, acceptedBy });
  if (!acceptedBy) return { success: false, error: "acceptedBy is required" };
  if (!isSupabaseEnabled()) {
    const all = getLocal();
    const i = all.findIndex((h) => h.id === id);
    if (i < 0) return { success: false, error: "handover not found" };
    if (all[i].status !== "pending") return { success: false, error: "already finalised" };
    all[i] = { ...all[i], status: "accepted", acceptedBy, acceptedBySignatureId: acceptedBySignatureId || null,
               acceptedByTeamSnapshot: acceptedByTeamSnapshot || null, acceptedAt: new Date().toISOString() };
    setLocal(all);
    return { success: true, handover: all[i] };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const updatePayload = {
    status: "accepted",
    accepted_by: acceptedBy,
    accepted_by_signature_id: acceptedBySignatureId || null,
    accepted_at: new Date().toISOString(),
    accepted_by_team_snapshot: acceptedByTeamSnapshot || null,
  };
  const { data, error } = await c
    .from("handover_events")
    .update(updatePayload)
    .eq("id", id)
    .eq("status", "pending")       // race-safe
    .select()
    .maybeSingle();
  if (error) {
    // Migration 031 may not be applied yet — retry without the new column.
    if (isMissingColumnError(error)) {
      console.warn("[handovers:accept] 031 column missing — retrying without team snapshot");
      const slim = { ...updatePayload };
      delete slim.accepted_by_team_snapshot;
      const { data: d2, error: e2 } = await c.from("handover_events").update(slim).eq("id", id).eq("status", "pending").select().maybeSingle();
      if (e2) { console.error("[handovers:accept] retry failed", e2); return { success: false, error: e2.message }; }
      if (!d2) return { success: false, error: "Handover is no longer pending (someone else may have accepted it)." };
      return { success: true, handover: fromRow(d2) };
    }
    console.error("[handovers:accept] failed", error); return { success: false, error: error.message };
  }
  if (!data)  return { success: false, error: "Handover is no longer pending (someone else may have accepted it)." };
  console.info("[handovers:accept] ok", { id });
  return { success: true, handover: fromRow(data) };
}

// Phase A does not expose Cancel in the UI, but the store supports it so
// Phase B can wire the button without needing a schema change.
// Migration 044 — an admin pulls a pending hand-over back (any sender). The
// RLS policy handover_events_admin_cancel decides who may; this only asks
// for status 'pending' so a race with an accept is refused, not overwritten.
export async function adminCancelHandover(id, reason) {
  if (!isSupabaseEnabled()) {
    const all = getLocal();
    const i = all.findIndex((h) => h.id === id);
    if (i < 0) return { success: false, error: "handover not found" };
    if (all[i].status !== "pending") return { success: false, error: "already finalised" };
    all[i] = { ...all[i], status: "cancelled", cancelledAt: new Date().toISOString(), cancellationReason: reason || "" };
    setLocal(all);
    return { success: true, handover: all[i] };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { data, error } = await c
    .from("handover_events")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancellation_reason: reason || null })
    .eq("id", id).eq("status", "pending")
    .select().maybeSingle();
  if (error) { console.error("[handover:adminCancel] failed", error); return { success: false, error: error.message }; }
  if (!data)  return { success: false, error: "This hand-over is no longer pending, or you are not allowed to pull it back." };
  return { success: true, handover: fromRow(data) };
}

export async function cancelHandover(id, reason, cancelledBy) {
  if (!isSupabaseEnabled()) {
    const all = getLocal();
    const i = all.findIndex((h) => h.id === id);
    if (i < 0) return { success: false, error: "handover not found" };
    if (all[i].status !== "pending") return { success: false, error: "already finalised" };
    all[i] = { ...all[i], status: "cancelled", cancelledAt: new Date().toISOString(), cancellationReason: reason || "" };
    setLocal(all);
    return { success: true };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { data, error } = await c
    .from("handover_events")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason || null,
    })
    .eq("id", id)
    .eq("status", "pending")
    .eq("sent_by", cancelledBy)
    .select()
    .maybeSingle();
  if (error) { console.error("[handovers:cancel] failed", error); return { success: false, error: error.message }; }
  if (!data)  return { success: false, error: "Only the sender can cancel a pending handover." };
  return { success: true, handover: fromRow(data) };
}
