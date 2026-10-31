// BOM Definitions store — public.bom_definitions
import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

const LOCAL_KEY = "erp_bomdefs";

function toRow(key, b) {
  return {
    key,
    label:         b.label || key,
    color:         b.color || null,
    rack_capacity: Number(b.rackCapacity) || 0,
    items:         b.items || [],
  };
}
// Migration 041 — per-department deadline minutes for this model. Kept out of
// toRow so the missing-column retry below can drop it on a pre-041 schema.
function durationsRow(b) {
  const d = b && b.deptDurations;
  if (!d || typeof d !== "object") return null;
  const out = {};
  for (const [dept, v] of Object.entries(d)) {
    const mins = Number(v && v.minutes);
    if (Number.isFinite(mins) && mins >= 0) out[dept] = { minutes: Math.floor(mins) };
  }
  return Object.keys(out).length ? out : null;
}
function isMissingDurationsColumn(error) {
  const msg = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`.toLowerCase();
  return error?.code === "42703" || error?.code === "PGRST204" || msg.includes("dept_durations") || msg.includes("schema cache");
}
function fromRow(r) {
  return {
    label:        r.label,
    color:        r.color || "",
    rackCapacity: Number(r.rack_capacity) || 0,
    items:        Array.isArray(r.items) ? r.items : [],
    deptDurations: r.dept_durations && typeof r.dept_durations === "object" ? r.dept_durations : null,
    // Migration 046 — a retired BOM (KM10/KM15/KM20 → M-10/M-15/M-20) stays
    // for history and labels but is hidden from issuing.
    retiredAt:    r.retired_at || null,
    replacedBy:   r.replaced_by || null,
  };
}

function getLocal() { try { const s = localStorage.getItem(LOCAL_KEY); if (s) return JSON.parse(s); } catch {} return {}; }
function setLocal(o) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(o)); } catch {} }

export async function fetchBOMs() {
  const mode = isSupabaseEnabled() ? "SUPABASE" : "LOCAL";
  console.info("[boms:load] start", { mode });
  if (!isSupabaseEnabled()) { const g = getLocal(); console.info("[boms:load] local ok", { count: Object.keys(g).length }); return g; }
  const c = getSupabase();
  if (!c) return getLocal();
  const { data, error } = await c.from("bom_definitions").select("*").order("key");
  if (error) { console.error("[boms:load] failed", error); return getLocal(); }
  const out = {};
  for (const r of (data || [])) out[r.key] = fromRow(r);
  setLocal(out);
  console.info("[boms:load] supabase ok", { count: Object.keys(out).length });
  return out;
}

export async function createBOM(key, def) {
  console.info("[boms:create] start", { key });
  if (!isSupabaseEnabled()) { const g = getLocal(); g[key] = def; setLocal(g); return { success: true }; }
  const c = getSupabase();
  if (!c) return { success: false, error: "no client" };
  const row = { ...toRow(key, def), dept_durations: durationsRow(def) };
  let { error } = await c.from("bom_definitions").insert(row);
  if (error && isMissingDurationsColumn(error)) {
    console.warn("[boms:create] 041 dept_durations not in schema yet — retrying without it");
    const { dept_durations: _d, ...legacy } = row;
    ({ error } = await c.from("bom_definitions").insert(legacy));
  }
  if (error) { console.error("[boms:create] failed", error); return { success: false, error: error.message }; }
  console.info("[boms:create] ok");
  return { success: true };
}

export async function updateBOM(key, def) {
  console.info("[boms:update] start", { key });
  if (!isSupabaseEnabled()) { const g = getLocal(); g[key] = def; setLocal(g); return { success: true }; }
  const c = getSupabase();
  if (!c) return { success: false, error: "no client" };
  const row = { ...toRow(key, def), dept_durations: durationsRow(def) }; delete row.key;
  // `.select("key")` is load-bearing: without it PostgREST answers an UPDATE
  // that matched ZERO rows with no error and no data, and this function
  // reported success for a write that never happened. `key` is the primary
  // key of bom_definitions (migration 002), so zero rows means either no such
  // BOM or an RLS policy hiding it from this user. Same trap as
  // machinesStore.updateMachine. Note the table has no `id` column.
  let { data, error } = await c.from("bom_definitions").update(row).eq("key", key).select("key");
  if (error && isMissingDurationsColumn(error)) {
    console.warn("[boms:update] 041 dept_durations not in schema yet — retrying without it");
    const { dept_durations: _d, ...legacy } = row;
    ({ data, error } = await c.from("bom_definitions").update(legacy).eq("key", key).select("key"));
  }
  if (error) { console.error("[boms:update] failed", error); return { success: false, error: error.message }; }
  if (!Array.isArray(data) || data.length === 0) {
    const msg = `BOM ${key} was not updated — no such row, or it is not visible to this user`;
    console.error("[boms:update] matched no rows", { key });
    return { success: false, error: msg, noRows: true };
  }
  console.info("[boms:update] ok");
  return { success: true };
}

export async function renameBOM(oldKey, newKey, newLabel) {
  console.info("[boms:rename] start", { oldKey, newKey });
  if (!isSupabaseEnabled()) {
    const g = getLocal();
    if (g[oldKey]) { const v = g[oldKey]; delete g[oldKey]; g[newKey] = { ...v, label: newLabel }; setLocal(g); }
    return { success: true };
  }
  const c = getSupabase();
  if (!c) return { success: false, error: "no client" };
  // Zero-row check matters most here: App.jsx fires the machine / outward /
  // pending cascades right after this resolves, so a rename that silently
  // touched nothing would still rewrite every child row to a BOM key that
  // does not exist. `.select("key")` returns the NEW key; only the row count
  // is checked.
  const { data, error } = await c.from("bom_definitions").update({ key: newKey, label: newLabel }).eq("key", oldKey).select("key");
  if (error) { console.error("[boms:rename] failed", error); return { success: false, error: error.message }; }
  if (!Array.isArray(data) || data.length === 0) {
    const msg = `BOM ${oldKey} was not renamed — no such row, or it is not visible to this user`;
    console.error("[boms:rename] matched no rows", { oldKey, newKey });
    return { success: false, error: msg, noRows: true };
  }
  console.info("[boms:rename] ok");
  return { success: true };
}

export async function deleteBOM(key) {
  console.info("[boms:delete] start", { key });
  if (!isSupabaseEnabled()) { const g = getLocal(); delete g[key]; setLocal(g); return { success: true }; }
  const c = getSupabase();
  if (!c) return { success: false, error: "no client" };
  // Same zero-row trap: a DELETE matching nothing is not an error to
  // PostgREST, so a safe-delete that hit an RLS wall would report success and
  // the BOM would reappear on the next reload.
  const { data, error } = await c.from("bom_definitions").delete().eq("key", key).select("key");
  if (error) { console.error("[boms:delete] failed", error); return { success: false, error: error.message }; }
  if (!Array.isArray(data) || data.length === 0) {
    const msg = `BOM ${key} was not deleted — no such row, or it is not visible to this user`;
    console.error("[boms:delete] matched no rows", { key });
    return { success: false, error: msg, noRows: true };
  }
  console.info("[boms:delete] ok");
  return { success: true };
}
