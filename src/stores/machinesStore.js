// Machine Log store — public.machine_log
import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

const LOCAL_KEY = "erp_machines";

function toRow(m) {
  const base = {
    issue_id:        m.issueId || null,
    bom_key:         m.bomKey,
    bom_label:       m.bomLabel || null,
    serial_no:       m.serialNo || null,
    stage:           m.stage || "BOM Issued",
    status:          m.status || "active",
    created_date:    m.createdDate   ? toIsoDate(m.createdDate)   : new Date().toISOString().slice(0, 10),
    completed_date:  m.completedDate ? toIsoDate(m.completedDate) : null,
    history:         m.history || [],
  };
  // Migration 021 columns — only set when the caller provided them so the
  // isMissingColumnError retry path (see updateMachine below) still works
  // against pre-021 schemas.
  if (m.currentDepartment     !== undefined) base.current_department    = m.currentDepartment    || null;
  if (m.departmentEnteredAt   !== undefined) base.department_entered_at = m.departmentEnteredAt  || null;
  if (m.pendingHandoverId     !== undefined) base.pending_handover_id   = m.pendingHandoverId    || null;
  // Migration 027 — per-machine department duration overrides. Captured once
  // at BOM Outward. Stripped-on-retry if the schema hasn't been migrated yet.
  if (m.deptDurations         !== undefined) base.dept_durations        = m.deptDurations        || null;
  // Migration 032 — Trial Certificate JSON payload. Saved when the Trial
  // department submits Finish & Transfer → Ready. Stripped-on-retry for
  // pre-032 schemas (isMissingColumnError path in updateMachine).
  if (m.trialCertificate      !== undefined) base.trial_certificate     = m.trialCertificate     || null;
  return base;
}
function fromRow(r) {
  return {
    id:             r.id,
    issueId:        r.issue_id || null,
    bomKey:         r.bom_key,
    bomLabel:       r.bom_label || "",
    serialNo:       r.serial_no || "",
    stage:          r.stage,
    status:         r.status,
    createdDate:    r.created_date   || "",
    completedDate:  r.completed_date || null,
    history:        Array.isArray(r.history) ? r.history : [],
    // Migration 021 — nullable before backfill runs; the UI falls back to
    // stage / createdDate when these are blank (see utils/handoverLogic).
    currentDepartment:   r.current_department   || null,
    departmentEnteredAt: r.department_entered_at || null,
    pendingHandoverId:   r.pending_handover_id   || null,
    // Migration 027 — per-machine duration overrides. NULL for legacy rows;
    // the Department Workflow falls back to settings.department_workflow.
    deptDurations:       (r.dept_durations && typeof r.dept_durations === "object") ? r.dept_durations : null,
    // Migration 032 — Trial Certificate payload. NULL for pre-032 rows.
    trialCertificate:    (r.trial_certificate && typeof r.trial_certificate === "object") ? r.trial_certificate : null,
  };
}

// Detects "column does not exist" / schema-cache errors so updateMachine
// can retry without the migration-021 columns if the operator hasn't run
// the migration yet. Same pattern as posStore / itemsStore.
function isMissingColumnError(err) {
  if (!err) return false;
  if (err.code === "42703" || err.code === "PGRST204") return true;
  return /column .* does not exist|schema cache|could not find the .* column/i.test(err.message || err.details || err.hint || "");
}
function toIsoDate(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s); if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function getLocal() { try { const s = localStorage.getItem(LOCAL_KEY); if (s) return JSON.parse(s); } catch {} return []; }
function setLocal(a) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(a)); } catch {} }

export async function fetchMachines() {
  const mode = isSupabaseEnabled() ? "SUPABASE" : "LOCAL";
  console.info("[machines:load] start", { mode });
  if (!isSupabaseEnabled()) return getLocal();
  const c = getSupabase(); if (!c) return getLocal();
  const { data, error } = await c.from("machine_log").select("*").order("created_at", { ascending: false });
  if (error) { console.error("[machines:load] failed", error); return getLocal(); }
  const out = (data || []).map(fromRow);
  setLocal(out);
  console.info("[machines:load] supabase ok", { count: out.length });
  return out;
}

export async function createMachine(m) {
  console.info("[machines:create] start", { bomKey: m.bomKey, serialNo: m.serialNo });
  if (!isSupabaseEnabled()) { setLocal([m, ...getLocal()]); return { success: true, machine: m }; }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const fullRow = toRow(m);
  let { data, error } = await c.from("machine_log").insert(fullRow).select().single();
  if (error && isMissingColumnError(error)) {
    console.warn("[machines:create] optional columns missing (migrations 021 / 027 / 032) — retrying stripped");
    const slim = { ...fullRow };
    delete slim.current_department;
    delete slim.department_entered_at;
    delete slim.pending_handover_id;
    delete slim.dept_durations;
    delete slim.trial_certificate;
    ({ data, error } = await c.from("machine_log").insert(slim).select().single());
  }
  if (error) { console.error("[machines:create] failed", error); return { success: false, error: error.message }; }
  console.info("[machines:create] ok");
  return { success: true, machine: fromRow(data) };
}

export async function updateMachineBomKey(oldKey, newKey, newLabel) {
  console.info("[machines:updateBomKey] start", { oldKey, newKey });
  if (!isSupabaseEnabled()) {
    setLocal(getLocal().map((m) => m.bomKey !== oldKey ? m : { ...m, bomKey: newKey, bomLabel: newLabel }));
    return { success: true };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { error } = await c.from("machine_log").update({ bom_key: newKey, bom_label: newLabel }).eq("bom_key", oldKey);
  if (error) { console.error("[machines:updateBomKey] failed", error); return { success: false, error: error.message }; }
  console.info("[machines:updateBomKey] ok");
  return { success: true };
}

export async function updateMachine(id, updates) {
  console.info("[machines:update] start", { id, fields: Object.keys(updates) });
  if (!isSupabaseEnabled()) { setLocal(getLocal().map((m) => m.id === id ? { ...m, ...updates } : m)); return { success: true }; }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const row = {};
  if (updates.stage              != null) row.stage          = updates.stage;
  if (updates.status             != null) row.status         = updates.status;
  if (updates.completedDate      != null) row.completed_date = toIsoDate(updates.completedDate);
  if (updates.history            != null) row.history        = updates.history;
  // Migration 021 columns (optional)
  if (updates.currentDepartment     !== undefined) row.current_department    = updates.currentDepartment    || null;
  if (updates.departmentEnteredAt   !== undefined) row.department_entered_at = updates.departmentEnteredAt  || null;
  if (updates.pendingHandoverId     !== undefined) row.pending_handover_id   = updates.pendingHandoverId;    // may be null to clear
  // Migration 032 — Trial Certificate payload (optional; strip on retry if schema not yet applied).
  if (updates.trialCertificate      !== undefined) row.trial_certificate     = updates.trialCertificate     || null;

  let { error } = await c.from("machine_log").update(row).eq("id", id);
  if (error && isMissingColumnError(error)) {
    console.warn("[machines:update] migration columns missing — retrying without 021/032 columns");
    delete row.current_department;
    delete row.department_entered_at;
    delete row.pending_handover_id;
    delete row.trial_certificate;
    ({ error } = await c.from("machine_log").update(row).eq("id", id));
  }
  if (error) { console.error("[machines:update] failed", error); return { success: false, error: error.message }; }
  console.info("[machines:update] ok");
  return { success: true };
}

// Feature 3: hard-delete a machine row. Used by the rack remove flow when the
// operator wants to cancel a rack build entirely. The App layer is responsible
// for reversing stock + audit logging BEFORE calling this — this is just the
// row-removal primitive.
export async function deleteMachine(id) {
  console.info("[machines:delete] start", { id });
  if (!isSupabaseEnabled()) {
    setLocal(getLocal().filter((m) => m.id !== id));
    return { success: true };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { error } = await c.from("machine_log").delete().eq("id", id);
  if (error) { console.error("[machines:delete] failed", error); return { success: false, error: error.message }; }
  console.info("[machines:delete] ok");
  return { success: true };
}
