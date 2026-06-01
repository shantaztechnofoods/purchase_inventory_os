// Busy/Tally-style searchable dropdown — pure keyboard ERP workflow.
//
// Props:
//   options    : array of { value, label, group? } — group is optional, used to
//                render section headers; rendering preserves input order.
//   value      : current selected value (option.value)
//   onChange   : (newValue) => void
//   onCommit?  : called when the user presses Enter to confirm — useful when
//                the parent wants to auto-advance focus to the next field.
//                Receives the chosen value.
//   placeholder: shown in the search input when nothing typed.
//   filter?    : (query, options) => filtered  — defaults to startsWith → includes
//                → word-startsWith on the label (case-insensitive). Pass a custom
//                filter for domain-aware matching (e.g. utils/gst.js
//                filterPurchaseTypes).
//   autoFocus? : focus the search input on mount.
//   id?        : DOM id forwarded to the search input (for label htmlFor).
//   className? : extra classes for the wrapper.
//   inputClassName? : extra classes for the search input.
//
// Keyboard:
//   typing       → instant filter
//   ArrowDown/Up → move highlight
//   Enter        → commit + close
//   Esc          → revert query, close
//   Tab/Shift-Tab→ commit (if highlighted) + close, then natural focus order
//                  proceeds (we don't preventDefault on Tab).
//
// The component intentionally does NOT use any React portal or focus-trap —
// the rest of the modal stays interactive and focus order is the natural DOM
// order. That's what makes Tab/Shift-Tab feel right in a long PO form.

import { useEffect, useMemo, useRef, useState } from "react";

const defaultFilter = (q, opts) => {
  const s = String(q || "").trim().toLowerCase();
  if (!s) return [...opts];
  const t1 = [], t2 = [], t3 = [];
  for (const o of opts) {
    const l = String(o.label || "").toLowerCase();
    if (l.startsWith(s))       { t1.push(o); continue; }
    if (l.includes(s))         { t2.push(o); continue; }
    if (l.split(/\s+/).some((w) => w.startsWith(s))) { t3.push(o); }
  }
  return [...t1, ...t2, ...t3];
};

export default function SearchableSelect({
  options = [],
  value,
  onChange,
  onCommit,
  placeholder = "Type to search…",
  filter = defaultFilter,
  autoFocus = false,
  id,
  className = "",
  inputClassName = "",
  disabled = false,
  emptyMessage = "No matches",
}) {
  const [query,    setQuery]    = useState("");
  const [open,     setOpen]     = useState(false);
  const [hi,       setHi]       = useState(0);   // highlighted index in filtered list
  const wrapRef   = useRef(null);
  const inputRef  = useRef(null);
  const listRef   = useRef(null);

  const selected = useMemo(
    () => options.find((o) => o.value === value) || null,
    [options, value]
  );

  // When closed, show the selected label in the search box. When open, show
  // the live query. This is the Busy behaviour — typing always replaces.
  const visibleText = open ? query : (selected?.label || "");

  const filtered = useMemo(
    () => (open ? filter(query, options) : options),
    [open, query, options, filter]
  );

  // Keep highlight inside filtered range.
  useEffect(() => {
    if (hi >= filtered.length) setHi(0);
  }, [filtered.length, hi]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Scroll highlighted item into view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${hi}"]`);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [hi, open]);

  // Autofocus on mount.
  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus();
  }, [autoFocus]);

  const openIt = () => { if (!disabled) { setOpen(true); setQuery(""); setHi(0); } };
  const commit = (opt) => {
    if (!opt) return;
    onChange?.(opt.value);
    setOpen(false);
    setQuery("");
    onCommit?.(opt.value);
  };

  const onKeyDown = (e) => {
    if (disabled) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { openIt(); return; }
      setHi((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { openIt(); return; }
      setHi((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      if (!open) { openIt(); return; }
      e.preventDefault();
      commit(filtered[hi]);
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setQuery("");
      }
    } else if (e.key === "Tab") {
      // Commit current highlight on Tab if the user typed a query, then let
      // the browser advance focus naturally.
      if (open && query && filtered[hi]) {
        commit(filtered[hi]);
      } else if (open) {
        setOpen(false);
      }
      // Do NOT preventDefault — Tab/Shift+Tab must move focus.
    }
  };

  // Render the list with optional group headers. We track when the group
  // changes between consecutive options.
  const renderList = () => {
    if (!filtered.length) {
      return <div className="px-3 py-3 text-[11px] text-slate-500 text-center">{emptyMessage}</div>;
    }
    let prevGroup = null;
    return filtered.map((o, i) => {
      const showGroup = o.group && o.group !== prevGroup;
      prevGroup = o.group || prevGroup;
      const isHi = i === hi;
      const isSel = o.value === value;
      return (
        <div key={o.value} role="option" aria-selected={isSel} data-idx={i}>
          {showGroup && (
            <div className="px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-[0.08em] text-slate-600">{o.group}</div>
          )}
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); commit(o); }}
            onMouseEnter={() => setHi(i)}
            className="w-full text-left px-3 py-2 text-[11px] flex items-center gap-2 transition-colors"
            style={{
              background: isHi ? "rgba(59,130,246,0.18)" : "transparent",
              color:      isSel ? "#bfdbfe" : "#e5e7eb",
              borderLeft: `2px solid ${isHi ? "#3b82f6" : "transparent"}`,
            }}>
            <span className="flex-1 truncate">{o.label}</span>
            {isSel && <span className="text-[9px] font-black text-blue-300">✓</span>}
          </button>
        </div>
      );
    });
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        value={visibleText}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={openIt}
        onChange={(e) => { setOpen(true); setQuery(e.target.value); setHi(0); }}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        autoComplete="off"
        spellCheck={false}
        className={`w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2.5 text-xs text-[#f0f6ff] placeholder-slate-500 outline-none modal-input ${inputClassName}`}
      />
      {open && (
        <div
          ref={listRef}
          role="listbox"
          className="absolute z-50 left-0 right-0 mt-1 rounded-xl overflow-y-auto"
          style={{
            top: "100%",
            maxHeight: 280,
            background: "linear-gradient(180deg,#0d1018,#090c14)",
            border: "1px solid rgba(59,130,246,0.45)",
            boxShadow: "0 20px 50px rgba(0,0,0,0.85)",
          }}>
          {renderList()}
        </div>
      )}
    </div>
  );
}
