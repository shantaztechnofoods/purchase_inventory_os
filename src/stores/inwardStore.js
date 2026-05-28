// Inward Log store — public.inward_log (append-only)
import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

const LOCAL_KEY = "erp_inward";

function toRow(e) {
  return {
    event_date: e.date ? toIsoDate(e.date) : new Date().toISOString().slice(0, 10),
    vendor:    e.vendor || null,
    item_code: e.code,
    item_name: e.item || e.name,
    unit:      e.unit || null,
    qty:       Number(e.qty) || 0,
    from_po:   e.fromPO || null,
    notes:     e.notes || null,
  };
}
function fromRow(r) {
  return {
    id:     r.id,
    date:   r.event_date,
    vendor: r.vendor || "",
    item:   r.item_name,
    code:   r.item_code,
    unit:   r.unit || "",
    qty:    Number(r.qty) || 0,
    fromPO: r.from_po || "",
    notes:  r.notes || "",
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

export async function fetchInward() {
  const mode = isSupabaseEnabled() ? "SUPABASE" : "LOCAL";
  console.info("[inward:load] start", { mode });
  if (!isSupabaseEnabled()) return getLocal();
  const c = getSupabase(); if (!c) return getLocal();
  const { data, error } = await c.from("inward_log").select("*").order("created_at", { ascending: false }).limit(500);
  if (error) { console.error("[inward:load] failed", error); return getLocal(); }
  const out = (data || []).map(fromRow);
  setLocal(out);
  console.info("[inward:load] supabase ok", { count: out.length });
  return out;
}

export async function createInward(entry) {
  console.info("[inward:create] start", { code: entry.code, qty: entry.qty });
  if (!isSupabaseEnabled()) { setLocal([entry, ...getLocal()]); return { success: true, entry }; }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { data, error } = await c.from("inward_log").insert(toRow(entry)).select().single();
  if (error) { console.error("[inward:create] failed", error); return { success: false, error: error.message }; }
  console.info("[inward:create] ok");
  return { success: true, entry: fromRow(data) };
}

export async function bulkCreateInward(entries) {
  console.info("[inward:bulkCreate] start", { count: entries.length });
  if (!isSupabaseEnabled()) { setLocal([...entries, ...getLocal()]); return { success: true }; }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const rows = entries.map(toRow);
  const { error } = await c.from("inward_log").insert(rows);
  if (error) { console.error("[inward:bulkCreate] failed", error); return { success: false, error: error.message }; }
  console.info("[inward:bulkCreate] ok");
  return { success: true };
}

export async function deleteInwardByPO(poId) {
  console.info("[inward:deleteByPO] start", { poId });
  if (!isSupabaseEnabled()) { setLocal(getLocal().filter((e) => e.fromPO !== poId)); return { success: true }; }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { error } = await c.from("inward_log").delete().eq("from_po", poId);
  if (error) { console.error("[inward:deleteByPO] failed", error); return { success: false, error: error.message }; }
  console.info("[inward:deleteByPO] ok");
  return { success: true };
}
