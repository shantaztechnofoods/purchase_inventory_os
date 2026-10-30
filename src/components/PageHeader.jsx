// Shared page header (2026-10-31 UI/responsive pass).
//
// MobileNavContext carries the "open navigation drawer" callback from the app
// shell. It lives here (not in App.jsx) so pages in src/pages can use it
// without importing App.jsx. PageHeader is the same header the in-App Topbar
// draws: menu button on phones, title + subtitle, and actions that wrap to a
// second line on narrow screens instead of running off the edge.
import React from "react";
import { Menu } from "lucide-react";

export const MobileNavContext = React.createContext(null);

export function PageHeader({ title, subtitle, children }) {
  const onMenu = React.useContext(MobileNavContext);
  return (
    <div className="page-header flex-shrink-0 no-print flex flex-wrap items-center gap-x-3 gap-y-2.5 px-4 sm:px-6 py-3.5"
         style={{ background: "var(--surface-card)", borderBottom: "1px solid var(--border-subtle)" }}>
      {onMenu && (
        <button onClick={onMenu} aria-label="Open navigation"
                className="nav-menu-btn flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
                style={{ color: "var(--text-dim)", border: "1px solid var(--border-subtle)" }}>
          <Menu size={18} aria-hidden="true" />
        </button>
      )}
      <div className="flex-1 min-w-[150px]">
        <h1 className="text-[17px] font-extrabold tracking-[-0.02em] leading-tight" style={{ color: "var(--text-strong)" }}>{title}</h1>
        {subtitle && <div className="text-[11.5px] mt-1 leading-snug" style={{ color: "var(--text-dim)" }}>{subtitle}</div>}
      </div>
      {children && <div className="page-header-actions flex items-center gap-2 flex-wrap">{children}</div>}
    </div>
  );
}
