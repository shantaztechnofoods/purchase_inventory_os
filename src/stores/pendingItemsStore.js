// Pending handover items store — public.pending_handover_items
// Raised during Accept; carried forward until explicitly resolved.

import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

const LOCAL_KEY = "erp_pending_handover_items";

const toRow = (p) => ({
  machine_id:            p.machineId,
  raised_in_handover_id: p.raisedInHandoverId || null,
  raised_in_department:  p.raisedInDepartment || null,
  raised_by:             p.raisedBy || null,
  description:           p.description || "",
  status:                "open",
});
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
});

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
  const { data, error } = await c.from("pending_handover_items").insert(toRow(p)).select().single();
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
