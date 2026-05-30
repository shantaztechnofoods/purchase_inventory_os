import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { AuthProvider } from './auth/AuthContext.jsx'

// ── Boot build marker ──────────────────────────────────────────────────────────
// Page-independent proof of which bundle is live. Shows a small green badge in the
// bottom-left corner on EVERY screen (even the login page) + a console banner.
// If you do NOT see "build 2026-05-29f" bottom-left in production, the served bundle
// is stale or the URL you opened is not this deployment.
export const APP_BUILD_TAG = "2026-05-30c-phase2";
if (typeof console !== "undefined") {
  console.warn(`%c[APP BUILD] ${APP_BUILD_TAG}`, "background:#16a34a;color:#fff;padding:2px 6px;border-radius:4px;font-weight:bold");
}
try {
  if (typeof document !== "undefined" && document.body && !document.getElementById("erp-build-badge")) {
    const b = document.createElement("div");
    b.id = "erp-build-badge";
    b.textContent = `build ${APP_BUILD_TAG}`;
    b.style.cssText = "position:fixed;left:6px;bottom:6px;z-index:2147483647;background:rgba(22,163,74,0.92);color:#fff;font:600 10px/1 ui-monospace,monospace;padding:4px 7px;border-radius:6px;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.45)";
    document.body.appendChild(b);
  }
} catch {}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>,
)
