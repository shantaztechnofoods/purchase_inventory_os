// Catches render errors in the active page so an exception in one component
// can't unmount the entire React tree. The shell (Sidebar + overlays) stays
// usable; the operator can navigate away from the broken page instead of
// hard-refreshing.
//
// Must be a class component — React's getDerivedStateFromError /
// componentDidCatch only exist on classes. There is no functional equivalent.
//
// The fallback shows:
//   - the error message + stack (so operators can paste it into a bug report)
//   - "Try again" — clears the error state, re-renders the same page
//   - "Go to Dashboard" — switches activePage via the provided callback
//   - "Reload app" — last-ditch hard refresh
//
// We also console.error the error with a clear tag so it's findable in the
// browser devtools. Vercel + Sentry-like tooling can pick it up from there.

import { Component } from "react";

const TAG = "%c[PageErrorBoundary]";
const TAG_STYLE = "background:#7f1d1d;color:#fff;padding:2px 6px;border-radius:4px;font-weight:bold";

export default class PageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, key: 0 };
  }

  static getDerivedStateFromError(error) {
    // Surface the error into state on the same render so the fallback renders
    // instead of the children.
    return { error };
  }

  componentDidCatch(error, info) {
    // info.componentStack is the React component stack (more useful than
    // error.stack for figuring out which page broke). Log both unconditionally
    // so the operator can copy them out.
    // eslint-disable-next-line no-console
    console.error(TAG, TAG_STYLE, "Render error in", this.props.pageId || "(unknown page)");
    // eslint-disable-next-line no-console
    console.error(TAG, TAG_STYLE, "error:", error);
    // eslint-disable-next-line no-console
    console.error(TAG, TAG_STYLE, "componentStack:", info?.componentStack || "(empty)");
    this.setState({ info });
  }

  componentDidUpdate(prevProps) {
    // Auto-reset when the operator navigates to a different page. Without
    // this, switching away after a crash would still show the fallback for
    // the new page because the boundary's error state is sticky.
    if (prevProps.pageId !== this.props.pageId && this.state.error) {
      this.setState({ error: null, info: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    const { error, info } = this.state;
    const onHome   = this.props.onNavigateHome;
    const onRetry  = () => this.setState({ error: null, info: null, key: this.state.key + 1 });
    const onReload = () => { try { window.location.reload(); } catch {} };

    return (
      <div className="flex-1 overflow-y-auto" style={{ background: "#080a0f" }}>
        <div className="max-w-2xl mx-auto py-16 px-6">
          <div className="rounded-2xl p-6"
               style={{ background: "#0d1018", border: "1px solid rgba(239,68,68,0.35)", boxShadow: "0 24px 60px rgba(0,0,0,0.7)" }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="text-3xl">⚠️</div>
              <div>
                <div className="text-sm font-black text-red-400">Something went wrong on this page</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  The rest of the app is still usable — pick a different page from the sidebar, or try again below.
                </div>
              </div>
            </div>

            <div className="rounded-xl p-3 mb-4 text-[11px] text-slate-300 font-mono whitespace-pre-wrap break-words"
                 style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.18)", maxHeight: 280, overflow: "auto" }}>
              <div className="font-bold text-red-300 mb-1">{error?.name || "Error"}: {error?.message || String(error)}</div>
              {info?.componentStack && (
                <div className="text-slate-500 mt-2 text-[10px] leading-relaxed">{info.componentStack.trim()}</div>
              )}
              {!info?.componentStack && error?.stack && (
                <div className="text-slate-500 mt-2 text-[10px] leading-relaxed">{String(error.stack)}</div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <button onClick={onRetry}
                      className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-white border transition-all"
                      style={{ background: "linear-gradient(135deg,#2563eb,#1d4ed8)", borderColor: "rgba(99,130,255,0.5)" }}>
                ↻ Try again
              </button>
              {onHome && (
                <button onClick={() => { this.setState({ error: null, info: null }); onHome(); }}
                        className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-slate-300 border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] hover:text-white transition-all">
                  🏠 Go to Dashboard
                </button>
              )}
              <button onClick={onReload}
                      className="text-[11px] font-bold px-3 py-1.5 rounded-lg text-slate-300 border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] hover:text-white transition-all">
                🔄 Reload app
              </button>
            </div>

            <div className="text-[9px] text-slate-600 mt-3">
              Page: <span className="font-mono text-slate-500">{this.props.pageId || "(unknown)"}</span>
              {" · "}Build: <span className="font-mono text-slate-500">{this.props.buildTag || "(unset)"}</span>
            </div>
          </div>

          <div className="text-[10px] text-slate-600 text-center mt-4">
            A full report has been printed to the browser console (look for <span className="font-mono text-slate-400">[PageErrorBoundary]</span>).
          </div>
        </div>
      </div>
    );
  }
}
