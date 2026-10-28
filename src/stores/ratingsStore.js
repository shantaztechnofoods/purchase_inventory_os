// Department ratings store — public.department_ratings
import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

const LOCAL_KEY = "erp_dept_ratings";

const toRow = (r) => ({
  machine_id:      r.machineId,
  department:      r.department,
  handover_id:     r.handoverId || null,
  rating:          Math.max(0, Math.min(5, Math.floor(Number(r.rating) || 0))),
  calculation_log: r.calculationLog || {},
});
const fromRow = (r) => ({
  id:              r.id,
  machineId:       r.machine_id,
  department:      r.department,
  handoverId:      r.handover_id || null,
  rating:          Number(r.rating) || 0,
  calculationLog:  r.calculation_log || {},
  overriddenBy:    r.overridden_by || null,
  overrideReason:  r.override_reason || "",
  overriddenAt:    r.overridden_at || null,
  createdAt:       r.created_at || null,
});

const getLocal = () => { try { const s = localStorage.getItem(LOCAL_KEY); if (s) return JSON.parse(s); } catch {} return []; };
const setLocal = (a) => { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(a)); } catch {} };

export async function fetchRatings() {
  if (!isSupabaseEnabled()) return getLocal();
  const c = getSupabase(); if (!c) return getLocal();
  const { data, error } = await c.from("department_ratings").select("*").order("created_at", { ascending: false });
  if (error) { console.warn("[ratings] load failed", error); return getLocal(); }
  const out = (data || []).map(fromRow);
  setLocal(out);
  return out;
}

export async function createRating(r) {
  if (!isSupabaseEnabled()) {
    const row = fromRow({ id: Date.now(), created_at: new Date().toISOString(), ...toRow(r) });
    setLocal([row, ...getLocal()]);
    return { success: true, rating: row };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { data, error } = await c.from("department_ratings").insert(toRow(r)).select().single();
  if (error) { console.error("[ratings:create] failed", error); return { success: false, error: error.message }; }
  return { success: true, rating: fromRow(data) };
}

export async function overrideRating(id, { rating, reason, overriddenBy }) {
  if (!isSupabaseEnabled()) {
    const all = getLocal().map((r) => r.id === id
      ? { ...r, rating: Math.max(0, Math.min(5, Math.floor(Number(rating) || 0))), overriddenBy, overrideReason: reason || "", overriddenAt: new Date().toISOString() }
      : r);
    setLocal(all);
    return { success: true };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  // `.select("id")` is load-bearing: without it PostgREST answers an UPDATE
  // that matched ZERO rows with no error and no data, and this function
  // reported success for a write that never happened. Zero rows means either
  // no such id or an RLS policy hiding the row from this user — both are
  // failures the caller must see. Same trap as machinesStore.updateMachine.
  // An override that silently did nothing is the worst case here: the operator
  // is told the rating was corrected on the record, and it was not.
  const { data, error } = await c.from("department_ratings").update({
    rating: Math.max(0, Math.min(5, Math.floor(Number(rating) || 0))),
    override_reason: reason || null,
    overridden_by: overriddenBy || null,
    overridden_at: new Date().toISOString(),
  }).eq("id", id).select("id");
  if (error) { console.error("[ratings:override] failed", error); return { success: false, error: error.message }; }
  if (!Array.isArray(data) || data.length === 0) {
    const msg = `rating ${id} was not overridden — no such row, or it is not visible to this user`;
    console.error("[ratings:override] matched no rows", { id });
    return { success: false, error: msg, noRows: true };
  }
  return { success: true };
}
