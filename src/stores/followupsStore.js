// Follow-ups store — public.follow_ups
import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

const LOCAL_KEY = "erp_followups";

function toRow(f) {
  return {
    po_id:           f.poId,
    vendor:          f.vendor || null,
    item_names:      f.itemNames || [],
    eta:             f.eta || null,
    confirmed_date:  f.confirmedDate ? toIsoDate(f.confirmedDate) : null,
    next_follow_up:  f.nextFollowUp  ? toIsoDate(f.nextFollowUp)  : null,
    last_follow_up:  f.lastFollowUp  ? toIsoDate(f.lastFollowUp)  : null,
    frequency:       Number(f.frequency) || null,
  };
}
function fromRow(r) {
  return {
    id:             r.id,
    poId:           r.po_id,
    vendor:         r.vendor || "",
    itemNames:      Array.isArray(r.item_names) ? r.item_names : [],
    eta:            r.eta || "",
    confirmedDate:  r.confirmed_date || "",
    nextFollowUp:   r.next_follow_up || "",
    lastFollowUp:   r.last_follow_up || null,
    frequency:      Number(r.frequency) || 1,
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

export async function fetchFollowUps() {
  const mode = isSupabaseEnabled() ? "SUPABASE" : "LOCAL";
  console.info("[followups:load] start", { mode });
  if (!isSupabaseEnabled()) return getLocal();
  const c = getSupabase(); if (!c) return getLocal();
  const { data, error } = await c.from("follow_ups").select("*").order("next_follow_up", { ascending: true });
  if (error) { console.error("[followups:load] failed", error); return getLocal(); }
  const out = (data || []).map(fromRow);
  setLocal(out);
  console.info("[followups:load] supabase ok", { count: out.length });
  return out;
}

export async function createFollowUp(f) {
  console.info("[followups:create] start", { poId: f.poId });
  if (!isSupabaseEnabled()) { setLocal([f, ...getLocal()]); return { success: true, followUp: f }; }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { data, error } = await c.from("follow_ups").insert(toRow(f)).select().single();
  if (error) { console.error("[followups:create] failed", error); return { success: false, error: error.message }; }
  console.info("[followups:create] ok");
  return { success: true, followUp: fromRow(data) };
}

export async function updateFollowUp(id, updates) {
  console.info("[followups:update] start", { id });
  if (!isSupabaseEnabled()) { setLocal(getLocal().map((f) => f.id === id ? { ...f, ...updates } : f)); return { success: true }; }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const row = {};
  if (updates.nextFollowUp != null) row.next_follow_up = toIsoDate(updates.nextFollowUp);
  if (updates.lastFollowUp != null) row.last_follow_up = toIsoDate(updates.lastFollowUp);
  if (updates.frequency    != null) row.frequency      = Number(updates.frequency);
  const { error } = await c.from("follow_ups").update(row).eq("id", id);
  if (error) { console.error("[followups:update] failed", error); return { success: false, error: error.message }; }
  console.info("[followups:update] ok");
  return { success: true };
}

export async function deleteFollowUpsByPO(poId) {
  console.info("[followups:deleteByPO] start", { poId });
  if (!isSupabaseEnabled()) { setLocal(getLocal().filter((f) => f.poId !== poId)); return { success: true }; }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { error } = await c.from("follow_ups").delete().eq("po_id", poId);
  if (error) { console.error("[followups:deleteByPO] failed", error); return { success: false, error: error.message }; }
  console.info("[followups:deleteByPO] ok");
  return { success: true };
}
