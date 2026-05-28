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

// Demo/seed data is OFF by default. It only ever loads when this is explicitly set to
// "true" AND Supabase is disabled (i.e. a deliberate local/offline dev session). It can
// never appear in a Supabase-backed or production build.
export const ALLOW_DEMO        = String(env.VITE_ALLOW_DEMO || "").toLowerCase() === "true";

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

// ── Boot banner ── (console.warn so it survives production console-stripping)
if (typeof console !== "undefined") {
  if (USE_SUPABASE) {
    console.warn("[BOOT] Supabase mode active — live database");
  } else {
    console.error(
      "[BOOT] Supabase NOT configured — app is in localStorage mode. " +
      "Set VITE_USE_SUPABASE=true, VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY " +
      "(in Vercel → Project → Settings → Environment Variables) and REDEPLOY."
    );
  }
  console.warn(ALLOW_DEMO && !USE_SUPABASE
    ? "[BOOT] Demo mode ENABLED (VITE_ALLOW_DEMO=true, local only)"
    : "[BOOT] Demo mode disabled");
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
