// Top-level error boundary mounted ABOVE AuthProvider in main.jsx.
//
// Why a second boundary on top of the per-page PageErrorBoundary:
//   - PageErrorBoundary lives INSIDE the App component. It catches errors
//     thrown by the Sidebar and the active page render. It does NOT catch
//     errors thrown by App's own body (state setup, notification computation,
//     handler definitions) or by AuthProvider — those happen ABOVE the
//     boundary in the tree, so React still unmounts everything and the
//     screen goes black.
//   - This component sits at the root and is the last line of defence:
//     anything that throws anywhere in the tree shows a recoverable error
//     panel instead of an empty <div id="root"> + body background.
//
// Kept deliberately dependency-free (no Tailwind utilities, no shared
// styles) so the fallback renders even if the global CSS or any shared
// constant happens to be the thing that's broken.

import { Component } from "react";

export default class RootErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    try {
      // eslint-disable-next-line no-console
      console.error(
        "%c[RootErrorBoundary] App-level render error",
        "background:#7f1d1d;color:#fff;padding:2px 6px;border-radius:4px;font-weight:bold",
        error
      );
      // eslint-disable-next-line no-console
      console.error("[RootErrorBoundary] componentStack:", info?.componentStack || "(empty)");
    } catch {}
    this.setState({ info });
  }

  reload = () => { try { window.location.reload(); } catch {} };

  resetAuth = () => {
    // Last-ditch: clearing the cached session forces the operator back to
    // the login screen. Useful when a malformed cached profile is what's
    // crashing the render.
    try { localStorage.removeItem("erp_session"); } catch {}
    try { localStorage.removeItem("erp_supabase_session"); } catch {}
    try { window.location.reload(); } catch {}
  };

  render() {
    if (!this.state.error) return this.props.children;
    const { error, info } = this.state;
    const message = error?.message || String(error);
    const stack   = info?.componentStack || error?.stack || "";

    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#080a0f",
          color: "#e5e7eb",
          fontFamily: "Inter, system-ui, -apple-system, sans-serif",
          padding: "48px 16px",
          display: "flex",
          justifyContent: "center",
          alignItems: "flex-start",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 640,
            background: "#0d1018",
            border: "1px solid rgba(239,68,68,0.4)",
            borderRadius: 16,
            padding: 24,
            boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ fontSize: 28 }}>⚠️</div>
            <div>
              <div style={{ color: "#f87171", fontWeight: 800, fontSize: 14 }}>
                The app hit an unrecoverable render error
              </div>
              <div style={{ color: "#6b7280", fontSize: 11, marginTop: 2 }}>
                Reload the page. If the error repeats, click "Sign out + reload" to clear the
                cached session and try logging in again.
              </div>
            </div>
          </div>

          <div
            style={{
              background: "rgba(239,68,68,0.05)",
              border: "1px solid rgba(239,68,68,0.18)",
              borderRadius: 12,
              padding: 12,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 11,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 280,
              overflow: "auto",
              color: "#cbd5e1",
              marginBottom: 16,
            }}
          >
            <div style={{ color: "#fca5a5", fontWeight: 700, marginBottom: 4 }}>
              {(error?.name || "Error") + ": " + message}
            </div>
            {stack && (
              <div style={{ color: "#64748b", fontSize: 10, lineHeight: 1.5 }}>{String(stack).trim()}</div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={this.reload}
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "6px 12px",
                borderRadius: 8,
                color: "#fff",
                background: "linear-gradient(135deg,#2563eb,#1d4ed8)",
                border: "1px solid rgba(99,130,255,0.5)",
                cursor: "pointer",
              }}
            >
              🔄 Reload page
            </button>
            <button
              onClick={this.resetAuth}
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "6px 12px",
                borderRadius: 8,
                color: "#fca5a5",
                background: "rgba(239,68,68,0.06)",
                border: "1px solid rgba(239,68,68,0.35)",
                cursor: "pointer",
              }}
            >
              ⎋ Sign out + reload
            </button>
          </div>

          <div style={{ color: "#475569", fontSize: 9, marginTop: 12 }}>
            A full report has been printed to the browser console (look for{" "}
            <span style={{ fontFamily: "ui-monospace,monospace", color: "#64748b" }}>
              [RootErrorBoundary]
            </span>
            ).
          </div>
        </div>
      </div>
    );
  }
}
