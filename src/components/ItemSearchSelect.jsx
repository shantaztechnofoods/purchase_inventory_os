import React, { useState, useEffect, useRef, useMemo } from "react";

// Highlight substring matches in a string. Returns React nodes.
function highlight(text, query) {
  if (!query) return text;
  const lower = String(text || "").toLowerCase();
  const q     = query.toLowerCase();
  const idx   = lower.indexOf(q);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: "rgba(99,102,241,0.45)", color: "#fff", padding: "0 1px", borderRadius: 2 }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

/**
 * Searchable inventory item selector.
 * Drop-in replacement for <select> in any place that picks one item from a flat list.
 *
 * Props:
 *  - items         array of { code, name, category?, unit?, stock? }
 *  - value         currently selected code (string)
 *  - onChange      (code) => void
 *  - excludeCodes  optional array of codes to hide (e.g. items already added)
 *  - placeholder   input placeholder text
 *  - disabled      disables the input
 *  - disabledMsg   message shown inside the closed input when disabled
 *  - showCategory  show category chip in each row (default true)
 *  - showStock     show stock value at right of each row (default false)
 *  - maxVisible    cap on visible matches (default 50 — keeps DOM small for 1000+ items)
 *  - autoFocus     focus + open on mount
 *  - className     wrapper class
 */
export default function ItemSearchSelect({
  items = [],
  value = "",
  onChange = () => {},
  excludeCodes = [],
  placeholder = "Search items by name or code…",
  disabled = false,
  disabledMsg = "",
  showCategory = true,
  showStock = false,
  maxVisible = 50,
  autoFocus = false,
  className = "",
}) {
  const [query, setQuery]         = useState("");
  const [open,  setOpen]          = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef  = useRef(null);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  const selected = useMemo(() => items.find((i) => i.code === value) || null, [items, value]);
  const displayValue = selected ? `${selected.code} — ${selected.name}` : "";

  // When value or selected changes from outside, sync the closed input
  useEffect(() => {
    if (!open) setQuery(displayValue);
  }, [displayValue, open]);

  useEffect(() => {
    if (autoFocus) { inputRef.current?.focus(); setOpen(true); }
  }, [autoFocus]);

  const excludeSet = useMemo(() => new Set(excludeCodes), [excludeCodes]);

  // Effective query: ignore the "code — name" display string when dropdown re-opens
  const isDisplayString = selected && query.trim() === displayValue.trim();
  const effectiveQuery  = isDisplayString ? "" : query.trim();

  const filtered = useMemo(() => {
    const q = effectiveQuery.toLowerCase();
    const out = [];
    for (const it of items) {
      if (out.length >= maxVisible) break;
      if (excludeSet.has(it.code) && it.code !== value) continue;
      if (!q) { out.push(it); continue; }
      const name = (it.name || "").toLowerCase();
      const code = (it.code || "").toLowerCase();
      if (name.includes(q) || code.includes(q)) out.push(it);
    }
    return out;
  }, [items, effectiveQuery, excludeSet, value, maxVisible]);

  // Reset active index when filter list changes
  useEffect(() => { setActiveIdx(0); }, [effectiveQuery]);

  // Click-outside closes
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQuery(displayValue);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, displayValue]);

  // Auto-scroll active row into view
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[activeIdx];
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  const pick = (it) => {
    onChange(it.code);
    setOpen(false);
    setQuery(`${it.code} — ${it.name}`);
    inputRef.current?.blur();
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      if (open && filtered[activeIdx]) { e.preventDefault(); pick(filtered[activeIdx]); }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery(displayValue);
      inputRef.current?.blur();
    }
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={open ? query : displayValue}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={(e) => {
          if (disabled) return;
          setOpen(true);
          setQuery("");
          // Brief delay before select so click positioning still works
          setTimeout(() => { try { e.target.select(); } catch {} }, 0);
        }}
        onKeyDown={onKeyDown}
        placeholder={disabled && disabledMsg ? disabledMsg : placeholder}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 pr-8 text-xs text-white placeholder-slate-500 outline-none focus:border-blue-500/40 transition-all"
        style={{ fontFamily: "'Inter',system-ui,sans-serif", opacity: disabled ? 0.55 : 1, cursor: disabled ? "not-allowed" : "text" }}
      />

      {/* Clear button (shows when something is selected and dropdown is closed) */}
      {!open && value && !disabled && (
        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); onChange(""); setQuery(""); inputRef.current?.focus(); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 rounded flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/[0.08] text-[11px] transition-all"
          title="Clear selection"
        >✕</button>
      )}
      {/* Chevron when nothing selected */}
      {!open && !value && !disabled && (
        <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 text-[9px] pointer-events-none">▾</span>
      )}

      {/* Dropdown */}
      {open && !disabled && (
        <div
          className="absolute left-0 right-0 mt-1 rounded-lg overflow-hidden z-50"
          style={{
            background: "#0d1119",
            border: "1px solid rgba(255,255,255,0.12)",
            boxShadow: "0 16px 48px rgba(0,0,0,0.65)",
          }}
        >
          <div ref={listRef} className="overflow-y-auto" style={{ maxHeight: 280 }}>
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-[11px] text-slate-500">
                <div className="text-2xl mb-1.5 opacity-40">🔍</div>
                No items found
                {effectiveQuery && <div className="text-[9px] text-slate-700 mt-0.5">for "{effectiveQuery}"</div>}
              </div>
            ) : (
              filtered.map((it, idx) => {
                const active = idx === activeIdx;
                return (
                  <button
                    key={it.code}
                    type="button"
                    onMouseEnter={() => setActiveIdx(idx)}
                    onMouseDown={(e) => e.preventDefault()} /* keep input focused so blur doesn't close before click fires */
                    onClick={() => pick(it)}
                    className="w-full text-left px-3 py-2 transition-colors flex items-center gap-2"
                    style={{
                      background: active ? "rgba(99,102,241,0.18)" : "transparent",
                      borderBottom: "1px solid rgba(255,255,255,0.03)",
                    }}
                  >
                    {showCategory && it.category && (
                      <span className="text-[8.5px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0"
                            style={{ background: "rgba(255,255,255,0.06)", color: "#94a3b8" }}>
                        {it.category}
                      </span>
                    )}
                    <span className="text-[10.5px] font-mono text-slate-400 flex-shrink-0 min-w-[70px]">
                      {highlight(it.code, effectiveQuery)}
                    </span>
                    <span className="text-[11px] text-white truncate flex-1">
                      {highlight(it.name, effectiveQuery)}
                    </span>
                    {showStock && typeof it.stock === "number" && (
                      <span className="text-[9.5px] text-slate-500 font-mono flex-shrink-0">
                        {it.stock}{it.unit ? ` ${it.unit}` : ""}
                      </span>
                    )}
                  </button>
                );
              })
            )}
            {filtered.length >= maxVisible && (
              <div className="px-3 py-1.5 text-center text-[9px] text-slate-700 border-t border-white/[0.05]">
                Showing first {maxVisible} matches — refine search to narrow further
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
