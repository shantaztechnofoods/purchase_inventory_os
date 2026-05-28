// Settings store — single row in public.settings keyed by 'org'.
// Dual path: localStorage when Supabase disabled, Supabase + local cache when enabled.

import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

const LOCAL_KEY = "erp_settings";

export function getSettingsLocal() {
  try { const s = localStorage.getItem(LOCAL_KEY); if (s) return JSON.parse(s); } catch {}
  return null;
}
function setSettingsLocal(v) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(v)); } catch {}
}

export async function loadSettings() {
  const mode = isSupabaseEnabled() ? "SUPABASE" : "LOCAL";
  console.info("[settings:load] start", { mode });
  if (!isSupabaseEnabled()) {
    const v = getSettingsLocal();
    console.info("[settings:load] local result", v ? "found" : "empty");
    return v;
  }
  const c = getSupabase();
  if (!c) {
    console.warn("[settings:load] supabase client null, falling back to local");
    return getSettingsLocal();
  }
  const { data, error } = await c.from("settings").select("value").eq("key", "org").maybeSingle();
  if (error) {
    console.error("[settings:load] supabase error", error);
    return getSettingsLocal();
  }
  console.info("[settings:load] supabase result", data ? "found" : "empty");
  if (data?.value) setSettingsLocal(data.value);
  return data?.value || null;
}

export async function saveSettings(value) {
  const mode = isSupabaseEnabled() ? "SUPABASE" : "LOCAL";
  console.info("[settings:save] start", { mode, keys: Object.keys(value || {}) });
  setSettingsLocal(value); // always cache
  if (!isSupabaseEnabled()) {
    console.info("[settings:save] local-only ok");
    return { success: true };
  }
  const c = getSupabase();
  if (!c) {
    console.warn("[settings:save] supabase client null, saved local only");
    return { success: false, error: "Supabase client not initialized" };
  }
  const { error } = await c.from("settings").upsert({ key: "org", value }, { onConflict: "key" });
  if (error) {
    console.error("[settings:save] supabase upsert failed", error);
    return { success: false, error: error.message };
  }
  console.info("[settings:save] supabase ok");
  return { success: true };
}
