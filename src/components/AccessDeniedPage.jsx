import React from "react";

export default function AccessDeniedPage({ onNavigateHome }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6"
         style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
      <div className="text-5xl mb-4" style={{ opacity: 0.35 }}>🔒</div>
      <h2 className="text-base font-bold text-slate-900 mb-2">Access Denied</h2>
      <p className="text-xs text-slate-500 max-w-xs leading-relaxed mb-6">
        You don't have permission to view this page. Contact your administrator if you believe this is an error.
      </p>
      {onNavigateHome && (
        <button onClick={onNavigateHome}
          className="px-4 py-2 rounded-xl text-xs font-semibold text-white transition-all"
          style={{ background: "#B01218", boxShadow: "0 1px 2px rgba(17,24,39,0.14)", color: "#ffffff" }}>
          Go to Home
        </button>
      )}
    </div>
  );
}
