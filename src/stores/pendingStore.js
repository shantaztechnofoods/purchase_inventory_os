// Pending Log store — public.pending_log
import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

const LOCAL_KEY = "erp_pending";

function toRow(p) {
  return {
    issue_id:    p.issueId || null,
    bom_key:     p.bomKey   || null,
    bom_label:   p.bomLabel || null,
    code:        p.code,
    name:        p.name || null,
    category:    p.category || null,
    unit:        p.unit || null,
    pending_qty: Number(p.pendingQty) || 0,
    issue_qty:   Number(p.issueQty)   || 0,
    serial_no:   p.serialNo || null,
    event_date:  p.date ? toIsoDate(p.date) : new Date().toISOString().slice(0, 10),
  };
}
function fromRow(r) {
  return {
    id:         r.id,
    issueId:    r.issue_id || null,
    bomKey:     r.bom_key   || "",
    bomLabel:   r.bom_label || "",
    code:       r.code,
    name:       r.name || "",
    category:   r.category || "",
    unit:       r.unit || "",
    pendingQty: Number(r.pending_qty) || 0,
    issueQty:   Number(r.issue_qty)   || 0,
    serialNo:   r.serial_no || "",
    date:       r.event_date,
  };
}
function toIsoDate(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s); if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function getLocal() { try { const s = localStorage.getItem(LOCAL_KEY); if (s) return JSON.parse(s); } catch {} return []; }
function setLocal(a) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(a)); } catch {} }

export async function fetchPending() {
  const mode = isSupabaseEnabled() ? "SUPABASE" : "LOCAL";
  console.info("[pending:load] start", { mode });
  if (!isSupabaseEnabled()) return getLocal();
  const c = getSupabase(); if (!c) return getLocal();
  const { data, error } = await c.from("pending_log").select("*").order("created_at", { ascending: false });
  if (error) { console.error("[pending:load] failed", error); return getLocal(); }
  const out = (data || []).map(fromRow);
  setLocal(out);
  console.info("[pending:load] supabase ok", { count: out.length });
  return out;
}

export async function bulkCreatePending(entries) {
  console.info("[pending:bulkCreate] start", { count: entries.length });
  if (!isSupabaseEnabled()) { setLocal([...entries, ...getLocal()]); return { success: true }; }
  if (!entries.length) return { success: true };
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const rows = entries.map(toRow);
  const { data, error } = await c.from("pending_log").insert(rows).select();
  if (error) { console.error("[pending:bulkCreate] failed", error); return { success: false, error: error.message }; }
  console.info("[pending:bulkCreate] ok");
  return { success: true, entries: (data || []).map(fromRow) };
}

export async function updatePending(id, updates) {
  console.info("[pending:update] start", { id });
  if (!isSupabaseEnabled()) { setLocal(getLocal().map((p) => p.id === id ? { ...p, ...updates } : p)); return { success: true }; }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const row = {};
  if (updates.pendingQty != null) row.pending_qty = updates.pendingQty;
  if (updates.issueQty   != null) row.issue_qty   = updates.issueQty;
  const { error } = await c.from("pending_log").update(row).eq("id", id);
  if (error) { console.error("[pending:update] failed", error); return { success: false, error: error.message }; }
  console.info("[pending:update] ok");
  return { success: true };
}

export async function updatePendingBomKey(oldKey, newKey, newLabel) {
  console.info("[pending:updateBomKey] start", { oldKey, newKey });
  if (!isSupabaseEnabled()) {
    setLocal(getLocal().map((p) => p.bomKey !== oldKey ? p : { ...p, bomKey: newKey, bomLabel: newLabel }));
    return { success: true };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { error } = await c.from("pending_log").update({ bom_key: newKey, bom_label: newLabel }).eq("bom_key", oldKey);
  if (error) { console.error("[pending:updateBomKey] failed", error); return { success: false, error: error.message }; }
  console.info("[pending:updateBomKey] ok");
  return { success: true };
}

export async function deletePending(id) {
  console.info("[pending:delete] start", { id });
  if (!isSupabaseEnabled()) { setLocal(getLocal().filter((p) => p.id !== id)); return { success: true }; }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { error } = await c.from("pending_log").delete().eq("id", id);
  if (error) { console.error("[pending:delete] failed", error); return { success: false, error: error.message }; }
  console.info("[pending:delete] ok");
  return { success: true };
}

export async function clearAllPending() {
  console.info("[pending:clearAll] start");
  if (!isSupabaseEnabled()) { setLocal([]); return { success: true }; }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { error } = await c.from("pending_log").delete().not("id", "is", null);
  if (error) { console.error("[pending:clearAll] failed", error); return { success: false, error: error.message }; }
  console.info("[pending:clearAll] ok");
  return { success: true };
}
