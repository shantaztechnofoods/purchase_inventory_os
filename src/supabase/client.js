// Null-safe Supabase client.
// Returns null when SUPABASE_URL / SUPABASE_ANON_KEY are not configured.
// Callers must check `if (client)` before using — never throws on missing env.
//
// Today (Phase 0): this is scaffolding only. Nothing in the ERP imports
// supabase calls yet — the entire app continues to run on localStorage.
//
// Future phases (per migration plan) will progressively swap localStorage
// helpers in src/auth/authStore.js, src/auth/auditStore.js, and App.jsx
// state initializers to read/write through this client.

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseEnabled, IS_PROD } from "../config/env.js";

let _client = null;
let _initLogged = false;

export function getSupabase() {
  if (_client) return _client;
  if (!isSupabaseEnabled()) {
    if (!_initLogged && typeof console !== "undefined") {
      console.warn("[supabase] getSupabase(): isSupabaseEnabled() is false — returning null. Check VITE_USE_SUPABASE and that VITE_SUPABASE_URL/ANON_KEY are set.");
      _initLogged = true;
    }
    return null;
  }
  try {
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "erp_supabase_session",
      },
    });
    if (typeof console !== "undefined") {
      console.info("[supabase] client initialized OK", { url: SUPABASE_URL.slice(0, 40) + "…" });
    }
    if (typeof window !== "undefined" && !IS_PROD) window.__SUPABASE__ = _client;  // debug-only
    return _client;
  } catch (err) {
    if (typeof console !== "undefined" && console.error) {
      console.error("[supabase] failed to initialize client", err);
    }
    return null;
  }
}

// Convenience: probe connection. Returns { ok: bool, error?: string }.
export async function probeSupabase() {
  const c = getSupabase();
  if (!c) return { ok: false, error: "Supabase not configured (set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY)" };
  try {
    const { error } = await c.from("users").select("id", { count: "exact", head: true }).limit(1);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
