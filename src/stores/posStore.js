// Purchase Orders store — public.purchase_orders
import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

const LOCAL_KEY = "erp_pos";

function toRow(p) {
  return {
    id:            p.id,
    vendor:        p.vendor,
    vendor_id:     p.vendorId || null,
    status:        p.status,
    date:          p.date ? toIsoDate(p.date) : null,
    ordered_date:  p.orderedDate  ? toIsoDate(p.orderedDate)  : null,
    received_date: p.receivedDate ? toIsoDate(p.receivedDate) : null,
    eta:           p.eta || null,
    priority:      p.priority || "normal",
    amount:        p.amount || null,
    gst:           p.gst    || null,
    notes:         p.notes  || null,
    reject_reason: p.rejectReason || null,
    line_items:    p.lineItems   || [],
    activity_log:  p.activityLog || [],
  };
}
function fromRow(r) {
  return {
    id:            r.id,
    vendor:        r.vendor,
    vendorId:      r.vendor_id || null,
    status:        r.status,
    date:          r.date || "",
    orderedDate:   r.ordered_date  || null,
    receivedDate:  r.received_date || null,
    eta:           r.eta      || "",
    priority:      r.priority || "normal",
    amount:        Number(r.amount) || 0,
    gst:           Number(r.gst)    || 0,
    notes:         r.notes        || "",
    rejectReason:  r.reject_reason || "",
    lineItems:     Array.isArray(r.line_items)   ? r.line_items   : [],
    activityLog:   Array.isArray(r.activity_log) ? r.activity_log : [],
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

export async function fetchPOs() {
  const mode = isSupabaseEnabled() ? "SUPABASE" : "LOCAL";
  console.info("[pos:load] start", { mode });
  if (!isSupabaseEnabled()) { const a = getLocal(); console.info("[pos:load] local ok", { count: a.length }); return a; }
  const c = getSupabase();
  if (!c) return getLocal();
  const { data, error } = await c.from("purchase_orders").select("*").order("created_at", { ascending: false });
  if (error) { console.error("[pos:load] failed", error); return getLocal(); }
  const out = (data || []).map(fromRow);
  setLocal(out);
  console.info("[pos:load] supabase ok", { count: out.length });
  return out;
}

export async function createPO(po) {
  console.info("[pos:create] start", { id: po.id });
  if (!isSupabaseEnabled()) { setLocal([po, ...getLocal()]); return { success: true, po }; }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { data, error } = await c.from("purchase_orders").insert(toRow(po)).select().single();
  if (error) { console.error("[pos:create] failed", error); return { success: false, error: error.message }; }
  const out = fromRow(data);
  console.info("[pos:create] ok");
  return { success: true, po: out };
}

export async function updatePO(id, updates) {
  console.info("[pos:update] start", { id, fields: Object.keys(updates) });
  if (!isSupabaseEnabled()) {
    setLocal(getLocal().map((p) => p.id === id ? { ...p, ...updates } : p));
    return { success: true };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const row = toRow({ id, ...updates }); delete row.id;
  Object.keys(row).forEach((k) => updates[mapCamel(k)] === undefined && updates[k] === undefined && delete row[k]);
  const { error } = await c.from("purchase_orders").update(row).eq("id", id);
  if (error) { console.error("[pos:update] failed", error); return { success: false, error: error.message }; }
  console.info("[pos:update] ok");
  return { success: true };
}
function mapCamel(snake) {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

export async function deletePO(id) {
  console.info("[pos:delete] start", { id });
  if (!isSupabaseEnabled()) { setLocal(getLocal().filter((p) => p.id !== id)); return { success: true }; }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { error } = await c.from("purchase_orders").delete().eq("id", id);
  if (error) { console.error("[pos:delete] failed", error); return { success: false, error: error.message }; }
  console.info("[pos:delete] ok");
  return { success: true };
}
