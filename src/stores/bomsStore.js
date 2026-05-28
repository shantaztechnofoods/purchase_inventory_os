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
function fromRow(r) {
  return {
    label:        r.label,
    color:        r.color || "",
    rackCapacity: Number(r.rack_capacity) || 0,
    items:        Array.isArray(r.items) ? r.items : [],
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
  const { error } = await c.from("bom_definitions").insert(toRow(key, def));
  if (error) { console.error("[boms:create] failed", error); return { success: false, error: error.message }; }
  console.info("[boms:create] ok");
  return { success: true };
}

export async function updateBOM(key, def) {
  console.info("[boms:update] start", { key });
  if (!isSupabaseEnabled()) { const g = getLocal(); g[key] = def; setLocal(g); return { success: true }; }
  const c = getSupabase();
  if (!c) return { success: false, error: "no client" };
  const row = toRow(key, def); delete row.key;
  const { error } = await c.from("bom_definitions").update(row).eq("key", key);
  if (error) { console.error("[boms:update] failed", error); return { success: false, error: error.message }; }
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
  const { error } = await c.from("bom_definitions").update({ key: newKey, label: newLabel }).eq("key", oldKey);
  if (error) { console.error("[boms:rename] failed", error); return { success: false, error: error.message }; }
  console.info("[boms:rename] ok");
  return { success: true };
}

export async function deleteBOM(key) {
  console.info("[boms:delete] start", { key });
  if (!isSupabaseEnabled()) { const g = getLocal(); delete g[key]; setLocal(g); return { success: true }; }
  const c = getSupabase();
  if (!c) return { success: false, error: "no client" };
  const { error } = await c.from("bom_definitions").delete().eq("key", key);
  if (error) { console.error("[boms:delete] failed", error); return { success: false, error: error.message }; }
  console.info("[boms:delete] ok");
  return { success: true };
}
