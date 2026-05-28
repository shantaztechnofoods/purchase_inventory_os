// Centralized environment-variable reader.
// All Vite env vars are exposed at build time via import.meta.env.

const env = import.meta.env || {};

export const SUPABASE_URL      = (env.VITE_SUPABASE_URL || "").trim();
export const SUPABASE_ANON_KEY = (env.VITE_SUPABASE_ANON_KEY || "").trim();
export const USE_SUPABASE      = String(env.VITE_USE_SUPABASE || "").toLowerCase() === "true"
                                 && !!SUPABASE_URL && !!SUPABASE_ANON_KEY;
export const APP_NAME          = env.VITE_APP_NAME || "Shantaz Technofoods ERP";
export const APP_ENV           = env.VITE_APP_ENV  || "development";
export const IS_PROD           = APP_ENV === "production";

// When this returns true, app should route persistence through Supabase.
// When false (default), the existing localStorage paths run unchanged.
export const isSupabaseEnabled = () => !!USE_SUPABASE;

// ── Diagnostic log at module init (visible in browser console on app start) ─
if (typeof console !== "undefined") {
  // eslint-disable-next-line no-console
  console.info("[env] config loaded", {
    VITE_USE_SUPABASE: env.VITE_USE_SUPABASE,
    VITE_SUPABASE_URL_present: !!SUPABASE_URL,
    VITE_SUPABASE_URL_preview: SUPABASE_URL ? SUPABASE_URL.slice(0, 40) + "…" : "(empty)",
    VITE_SUPABASE_ANON_KEY_present: !!SUPABASE_ANON_KEY,
    VITE_SUPABASE_ANON_KEY_length: SUPABASE_ANON_KEY.length,
    USE_SUPABASE_resolved: !!USE_SUPABASE,
  });
}

// Expose for browser-console inspection — DEV/STAGING ONLY
if (typeof window !== "undefined" && !IS_PROD) {
  window.__ERP_ENV__ = {
    VITE_USE_SUPABASE: env.VITE_USE_SUPABASE,
    SUPABASE_URL_preview: SUPABASE_URL ? SUPABASE_URL.slice(0, 40) + "…" : "",
    SUPABASE_ANON_KEY_length: SUPABASE_ANON_KEY.length,
    USE_SUPABASE: !!USE_SUPABASE,
  };
}
