// Pending handover items store — public.pending_handover_items
// Raised during Accept; carried forward until explicitly resolved.

import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

const LOCAL_KEY = "erp_pending_handover_items";

const toRow = (p) => {
  const row = {
    machine_id:            p.machineId,
    raised_in_handover_id: p.raisedInHandoverId || null,
    raised_in_department:  p.raisedInDepartment || null,
    raised_by:             p.raisedBy || null,
    description:           p.description || "",
    status:                "open",
  };
  // Migration 033 — only set when the caller provided it, so the
  // isMissingColumnError retry path below still works against pre-033 schemas.
  if (p.assignedDepartment !== undefined) {
    row.assigned_department = p.assignedDepartment || null;
  }
  return row;
};
const fromRow = (r) => ({
  id:                   r.id,
  machineId:            r.machine_id,
  raisedInHandoverId:   r.raised_in_handover_id || null,
  raisedInDepartment:   r.raised_in_department || "",
  raisedBy:             r.raised_by || null,
  raisedAt:             r.raised_at || null,
  description:          r.description || "",
  resolvedAt:           r.resolved_at || null,
  resolvedBy:           r.resolved_by || null,
  resolvedInDepartment: r.resolved_in_department || "",
  resolutionNotes:      r.resolution_notes || "",
  status:               r.status || "open",
  // Migration 033 — department that must come and fix this. Empty string for
  // pre-033 rows and for items raised without an assignment.
  assignedDepartment:   r.assigned_department || "",
});

// Detects "column does not exist" / schema-cache errors so createPendingItem
// can retry without the migration-033 column if the operator hasn't run it yet.
// Mirrors the same guard in machinesStore.updateMachine.
function isMissingColumnError(error) {
  if (!error) return false;
  const msg = `${error.message || ""} ${error.details || ""} ${error.hint || ""}`.toLowerCase();
  return error.code === "42703"
    || error.code === "PGRST204"
    || msg.includes("assigned_department")
    || (msg.includes("column") && msg.includes("does not exist"))
    || msg.includes("schema cache");
}

const getLocal = () => { try { const s = localStorage.getItem(LOCAL_KEY); if (s) return JSON.parse(s); } catch {} return []; };
const setLocal = (a) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(a)); } catch {} };

export async function fetchPendingItems() {
  if (!isSupabaseEnabled()) return getLocal();
  const c = getSupabase(); if (!c) return getLocal();
  const { data, error } = await c.from("pending_handover_items").select("*").order("raised_at", { ascending: false });
  if (error) { console.warn("[pending_items] load failed", error); return getLocal(); }
  const out = (data || []).map(fromRow);
  setLocal(out);
  return out;
}

export async function createPendingItem(p) {
  if (!isSupabaseEnabled()) {
    const row = fromRow({ id: Date.now(), raised_at: new Date().toISOString(), ...toRow(p) });
    setLocal([row, ...getLocal()]);
    return { success: true, item: row };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const row = toRow(p);
  let { data, error } = await c.from("pending_handover_items").insert(row).select().single();
  // Migration 033 may not have been applied yet. Strip the new column and
  // retry once so the deployed build keeps working against a pre-033 schema —
  // the assignment is simply not recorded until the migration runs.
  if (error && isMissingColumnError(error) && "assigned_department" in row) {
    console.warn("[pending_items:create] assigned_department not in schema yet — retrying without it");
    const { assigned_department: _omit, ...legacyRow } = row;
    ({ data, error } = await c.from("pending_handover_items").insert(legacyRow).select().single());
  }
  if (error) { console.error("[pending_items:create] failed", error); return { success: false, error: error.message }; }
  return { success: true, item: fromRow(data) };
}

export async function resolvePendingItem(id, { resolvedBy, resolvedInDepartment, notes }) {
  if (!isSupabaseEnabled()) {
    const all = getLocal().map((p) => p.id === id
      ? { ...p, status: "resolved", resolvedBy, resolvedAt: new Date().toISOString(), resolvedInDepartment, resolutionNotes: notes || "" }
      : p);
    setLocal(all);
    return { success: true };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { data, error } = await c.from("pending_handover_items").update({
    status: "resolved",
    resolved_by: resolvedBy,
    resolved_at: new Date().toISOString(),
    resolved_in_department: resolvedInDepartment || null,
    resolution_notes: notes || null,
  }).eq("id", id).eq("status", "open").select().maybeSingle();
  if (error) { console.error("[pending_items:resolve] failed", error); return { success: false, error: error.message }; }
  if (!data)  return { success: false, error: "Item is already resolved." };
  return { success: true, item: fromRow(data) };
}
