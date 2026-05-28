import React, { useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import { getAuditLog, subscribeAudit, fetchAuditFromSupabase } from "../auth/auditStore.js";
import { isSupabaseEnabled } from "../config/env.js";

const MODULE_LABELS = {
  Auth: "🔐 Authentication",
  "User Mgmt": "👤 User Management",
  "Role Mgmt": "🛡️ Role Management",
  Purchase: "🛒 Purchase",
  Inventory: "📦 Inventory",
  Inward: "📥 Inward",
  Outward: "📤 Outward",
  Pending: "⏳ Pending",
  BOM: "⚙️ BOM",
  Machine: "🔧 Machine",
  Vendor: "🏭 Vendor",
  Settings: "⚙️ Settings",
};

const TYPE_META = {
  login:                 { label: "Login",                color: "#22c55e" },
  login_failed:          { label: "Failed Login",         color: "#ef4444" },
  logout:                { label: "Logout",               color: "#64748b" },
  password_change:       { label: "Password Changed",     color: "#3b82f6" },
  profile_update:        { label: "Profile Updated",      color: "#3b82f6" },
  user_create:           { label: "User Created",         color: "#22c55e" },
  user_edit:             { label: "User Updated",         color: "#3b82f6" },
  user_delete:           { label: "User Deleted",         color: "#ef4444" },
  user_disabled:         { label: "User Disabled",        color: "#f59e0b" },
  user_enabled:          { label: "User Enabled",         color: "#22c55e" },
  user_password_reset:   { label: "Password Reset (admin)", color: "#8b5cf6" },
  role_create:           { label: "Role Created",         color: "#22c55e" },
  role_edit:             { label: "Role Updated",         color: "#3b82f6" },
  role_delete:           { label: "Role Deleted",         color: "#ef4444" },
  role_reset:            { label: "Roles Reset",          color: "#64748b" },
  role_changed:          { label: "Role Changed",         color: "#8b5cf6" },
  po_created:            { label: "PO Created",           color: "#3b82f6" },
  po_edited:             { label: "PO Edited",            color: "#3b82f6" },
  po_approved:           { label: "PO Approved",          color: "#22c55e" },
  po_rejected:           { label: "PO Rejected",          color: "#ef4444" },
  po_ordered:            { label: "Order Placed",         color: "#6366f1" },
  po_received:           { label: "PO Received",          color: "#10b981" },
  po_receive_reversed:   { label: "Receive Reversed",     color: "#f59e0b" },
  po_deleted:            { label: "PO Deleted",           color: "#64748b" },
  po_deleted_received:   { label: "PO Deleted (Received)",color: "#ef4444" },
  followup_done:         { label: "Follow-Up Done",       color: "#f97316" },
  inventory_correction:  { label: "Inventory Correction", color: "#f59e0b" },
  inventory_add:         { label: "Item Added",           color: "#22c55e" },
  inventory_edit:        { label: "Item Updated",         color: "#3b82f6" },
  inventory_delete:      { label: "Item Deleted",         color: "#ef4444" },
  stock_adjust:          { label: "Stock Adjusted",       color: "#8b5cf6" },
  inward_manual:         { label: "Manual Inward",        color: "#10b981" },
  outward_bom:           { label: "BOM Issued",           color: "#f59e0b" },
  outward_manual:        { label: "Manual Outward",       color: "#fb923c" },
  pending_fulfilled:     { label: "Pending Fulfilled",    color: "#22c55e" },
  pending_cleared:       { label: "Pending Cleared",      color: "#64748b" },
  bom_updated:           { label: "BOM Updated",          color: "#f59e0b" },
  bom_created:           { label: "BOM Created",          color: "#22c55e" },
  bom_renamed:           { label: "BOM Renamed",          color: "#8b5cf6" },
  machine_created:       { label: "Machine Created",      color: "#3b82f6" },
  machine_stage:         { label: "Stage Updated",        color: "#6366f1" },
  machine_completed:     { label: "Machine Completed",    color: "#22c55e" },
  production_started:    { label: "Production Started",   color: "#22c55e" },
  vendor_add:            { label: "Vendor Added",         color: "#22c55e" },
  vendor_edit:           { label: "Vendor Updated",       color: "#3b82f6" },
  vendor_delete:         { label: "Vendor Deleted",       color: "#ef4444" },
};

function fmtTs(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  } catch { return iso; }
}

function shortVal(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

function exportCSV(rows) {
  const cols = ["timestamp","date","user","role","module","action_type","action","reference","vendor","item_code","qty","amount","old_value","new_value"];
  const head = cols.map((c) => `"${c}"`).join(",");
  const body = rows.map((r) =>
    [
      r.ts, r.date, r.user, r.role,
      r.module, TYPE_META[r.type]?.label || r.type,
      r.action, r.ref, r.vendor, r.itemCode,
      r.qty || "", r.amount || "",
      shortVal(r.oldValue), shortVal(r.newValue),
    ].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")
  ).join("\n");
  const blob = new Blob([head + "\n" + body], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = `audit_trail_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}

function exportExcel(rows) {
  const cols = [
    { key: "ts", label: "Timestamp" }, { key: "user", label: "User" }, { key: "role", label: "Role" },
    { key: "module", label: "Module" }, { key: "typeLabel", label: "Action Type" },
    { key: "action", label: "Description" }, { key: "ref", label: "Reference" },
    { key: "vendor", label: "Vendor" }, { key: "itemCode", label: "Item Code" },
    { key: "qty", label: "Qty" }, { key: "amount", label: "Amount" },
    { key: "oldShort", label: "Old Value" }, { key: "newShort", label: "New Value" },
  ];
  const th = `style="background:#0f172a;color:#fff;padding:8px 12px;border:1px solid #1e293b;font-size:12px;text-align:left"`;
  const td = `style="padding:7px 12px;border:1px solid #e2e8f0;font-size:11px;vertical-align:top"`;
  const head = `<tr>${cols.map((c) => `<th ${th}>${c.label}</th>`).join("")}</tr>`;
  const body = rows.map((r) => {
    const enriched = { ...r, typeLabel: TYPE_META[r.type]?.label || r.type, oldShort: shortVal(r.oldValue), newShort: shortVal(r.newValue) };
    return `<tr>${cols.map((c) => `<td ${td}>${enriched[c.key] ?? ""}</td>`).join("")}</tr>`;
  }).join("");
  const html = `<html><head><meta charset="utf-8"/></head><body><table border="1">${head}${body}</table></body></html>`;
  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = `audit_trail_${new Date().toISOString().slice(0, 10)}.xls`; a.click();
  URL.revokeObjectURL(url);
}

export default function AuditHistoryPage() {
  const { users, roles } = useAuth();
  const [logs, setLogs]   = useState(() => getAuditLog());
  // Always subscribe to local audit changes (for instant UI updates after the user's own actions).
  React.useEffect(() => subscribeAudit((next) => setLogs(next)), []);
  // When Supabase is enabled, also pull the canonical multi-user log on mount + after each local write.
  React.useEffect(() => {
    if (!isSupabaseEnabled()) return;
    let cancelled = false;
    const pull = async () => {
      const remote = await fetchAuditFromSupabase({ limit: 1000 });
      if (cancelled || !remote) return;
      // Merge: prefer Supabase rows by (ts + type + ref + user_id). Local rows already in localStorage
      // remain visible if Supabase didn't return them (e.g. offline append). Sort by ts desc.
      const seen = new Set(remote.map((r) => `${r.ts}|${r.type}|${r.ref}|${r.userId}`));
      const localOnly = getAuditLog().filter((l) => !seen.has(`${l.ts}|${l.type}|${l.ref}|${l.userId}`));
      const merged = [...remote, ...localOnly].sort((a, b) => (a.ts < b.ts ? 1 : -1));
      setLogs(merged);
    };
    pull();
    const unsub = subscribeAudit(() => { pull(); });
    return () => { cancelled = true; unsub(); };
  }, []);

  const [search,        setSearch]        = useState("");
  const [dateFrom,      setDateFrom]      = useState("");
  const [dateTo,        setDateTo]        = useState("");
  const [userFilter,    setUserFilter]    = useState("");
  const [moduleFilter,  setModuleFilter]  = useState("");
  const [typeFilter,    setTypeFilter]    = useState("");
  const [poFilter,      setPoFilter]      = useState("");
  const [vendorFilter,  setVendorFilter]  = useState("");
  const [sortBy,        setSortBy]        = useState("ts");
  const [sortDir,       setSortDir]       = useState("desc");
  const [page,          setPage]          = useState(0);
  const [pageSize,      setPageSize]      = useState(25);
  const [expanded,      setExpanded]      = useState(null);

  const resetFilters = () => {
    setSearch(""); setDateFrom(""); setDateTo("");
    setUserFilter(""); setModuleFilter(""); setTypeFilter("");
    setPoFilter(""); setVendorFilter(""); setPage(0);
  };

  const allModules = useMemo(() => Array.from(new Set(logs.map((l) => l.module).filter(Boolean))).sort(), [logs]);
  const allTypes   = useMemo(() => Array.from(new Set(logs.map((l) => l.type).filter(Boolean))).sort(), [logs]);
  const allUsers   = useMemo(() => Array.from(new Set(logs.map((l) => l.user).filter(Boolean))).sort(), [logs]);
  const allVendors = useMemo(() => Array.from(new Set(logs.map((l) => l.vendor).filter(Boolean))).sort(), [logs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (dateFrom || dateTo) {
        const iso = l.ts ? l.ts.slice(0, 10) : "";
        if (dateFrom && iso < dateFrom) return false;
        if (dateTo   && iso > dateTo)   return false;
      }
      if (userFilter   && l.user   !== userFilter)   return false;
      if (moduleFilter && l.module !== moduleFilter) return false;
      if (typeFilter   && l.type   !== typeFilter)   return false;
      if (vendorFilter && l.vendor !== vendorFilter) return false;
      if (poFilter) {
        const ref = String(l.ref || "");
        if (!ref.toLowerCase().includes(poFilter.toLowerCase())) return false;
      }
      if (q) {
        const blob = [
          l.action, l.ref, l.vendor, l.itemCode, l.itemName,
          l.user, l.module, l.type,
          shortVal(l.oldValue), shortVal(l.newValue),
        ].join(" ").toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
  }, [logs, search, dateFrom, dateTo, userFilter, moduleFilter, typeFilter, poFilter, vendorFilter]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const va = a[sortBy], vb = b[sortBy];
      if (va === vb) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va < vb ? -1 : 1) * (sortDir === "asc" ? 1 : -1);
    });
    return arr;
  }, [filtered, sortBy, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage   = Math.min(page, totalPages - 1);
  const pageRows   = sorted.slice(safePage * pageSize, safePage * pageSize + pageSize);

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortBy(col); setSortDir("desc"); }
  };

  const Th = ({ col, children, w }) => (
    <th onClick={() => toggleSort(col)}
        className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-wide cursor-pointer hover:text-white transition-colors select-none"
        style={{ width: w }}>
      <div className="flex items-center gap-1">
        {children}
        {sortBy === col && <span className="text-slate-500">{sortDir === "asc" ? "▲" : "▼"}</span>}
      </div>
    </th>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div>
          <div className="text-base font-bold text-white">Audit Trail</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {sorted.length.toLocaleString("en-IN")} of {logs.length.toLocaleString("en-IN")} entries
            {sorted.length !== logs.length && <span className="text-amber-400 ml-1">· filtered</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => exportCSV(sorted)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:text-white transition-all"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
            📥 CSV
          </button>
          <button onClick={() => exportExcel(sorted)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-all"
            style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)" }}>
            📊 Excel
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-3 flex flex-wrap items-center gap-2" style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div className="relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-xs">🔍</span>
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder="Search action, ref, user, item…"
            className="bg-white/[0.04] border border-white/[0.08] rounded-lg pl-7 pr-3 py-1.5 text-xs text-slate-300 placeholder-slate-600 outline-none focus:border-blue-500/40 w-56" />
        </div>

        <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(0); }}
          className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-400 outline-none focus:border-blue-500/40" title="From date" />
        <span className="text-slate-600 text-xs">→</span>
        <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(0); }}
          className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-400 outline-none focus:border-blue-500/40" title="To date" />

        <select value={userFilter} onChange={(e) => { setUserFilter(e.target.value); setPage(0); }}
          className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-400 outline-none focus:border-blue-500/40">
          <option value="">All Users</option>
          {allUsers.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>

        <select value={moduleFilter} onChange={(e) => { setModuleFilter(e.target.value); setPage(0); }}
          className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-400 outline-none focus:border-blue-500/40">
          <option value="">All Modules</option>
          {allModules.map((m) => <option key={m} value={m}>{MODULE_LABELS[m] || m}</option>)}
        </select>

        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
          className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-400 outline-none focus:border-blue-500/40">
          <option value="">All Action Types</option>
          {allTypes.map((t) => <option key={t} value={t}>{TYPE_META[t]?.label || t}</option>)}
        </select>

        <input value={poFilter} onChange={(e) => { setPoFilter(e.target.value); setPage(0); }}
          placeholder="PO # / Ref"
          className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-400 placeholder-slate-600 outline-none focus:border-blue-500/40 w-28" />

        <select value={vendorFilter} onChange={(e) => { setVendorFilter(e.target.value); setPage(0); }}
          className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-400 outline-none focus:border-blue-500/40">
          <option value="">All Vendors</option>
          {allVendors.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>

        {(search || dateFrom || dateTo || userFilter || moduleFilter || typeFilter || poFilter || vendorFilter) && (
          <button onClick={resetFilters}
            className="text-[10px] font-bold text-slate-500 hover:text-slate-300 px-2 py-1.5 rounded-lg border border-white/[0.06] hover:border-white/[0.14] transition-all">
            ✕ Reset
          </button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10" style={{ background: "#0a0d14" }}>
            <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <Th col="ts"     w={150}>Timestamp</Th>
              <Th col="user"   w={140}>User</Th>
              <Th col="module" w={120}>Module</Th>
              <Th col="type"   w={140}>Action Type</Th>
              <th className="px-3 py-2.5 text-left text-[10px] font-bold text-slate-400 uppercase tracking-wide">Description</th>
              <Th col="ref"    w={110}>Reference</Th>
              <th className="px-3 py-2.5 text-center text-[10px] font-bold text-slate-400 uppercase tracking-wide" style={{ width: 60 }}></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 && (
              <tr><td colSpan={7} className="text-center text-slate-600 text-xs py-10">No audit entries match your filters</td></tr>
            )}
            {pageRows.map((r) => {
              const meta = TYPE_META[r.type] || { label: r.type, color: "#64748b" };
              const isExpanded = expanded === r.id;
              return (
                <React.Fragment key={r.id}>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.02)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = ""}>
                    <td className="px-3 py-2.5 text-slate-400 font-mono text-[10.5px]">{fmtTs(r.ts)}</td>
                    <td className="px-3 py-2.5">
                      <div className="text-white font-semibold text-[11px]">{r.user || "System"}</div>
                      {r.role && <div className="text-slate-600 text-[9px]">{r.role}</div>}
                    </td>
                    <td className="px-3 py-2.5 text-slate-400">{MODULE_LABELS[r.module] || r.module}</td>
                    <td className="px-3 py-2.5">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                            style={{ background: meta.color + "20", color: meta.color }}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-300 text-[11px]">{r.action}</td>
                    <td className="px-3 py-2.5 text-slate-500 font-mono text-[10px]">{r.ref || "—"}</td>
                    <td className="px-3 py-2.5 text-center">
                      {(r.oldValue || r.newValue || r.details) && (
                        <button onClick={() => setExpanded(isExpanded ? null : r.id)}
                          className="text-slate-500 hover:text-white transition-colors text-[11px]">
                          {isExpanded ? "▲" : "▼"}
                        </button>
                      )}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr style={{ background: "rgba(99,102,241,0.04)" }}>
                      <td colSpan={7} className="px-6 py-3">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Old Value</div>
                            <pre className="text-[10px] text-slate-300 p-2 rounded-lg overflow-x-auto whitespace-pre-wrap"
                                 style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(239,68,68,0.15)" }}>
                              {r.oldValue ? JSON.stringify(r.oldValue, null, 2) : "—"}
                            </pre>
                          </div>
                          <div>
                            <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">New Value</div>
                            <pre className="text-[10px] text-slate-300 p-2 rounded-lg overflow-x-auto whitespace-pre-wrap"
                                 style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(52,211,153,0.15)" }}>
                              {r.newValue ? JSON.stringify(r.newValue, null, 2) : "—"}
                            </pre>
                          </div>
                          {r.details && (
                            <div className="col-span-2">
                              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wide mb-1.5">Details</div>
                              <pre className="text-[10px] text-slate-400 p-2 rounded-lg overflow-x-auto whitespace-pre-wrap"
                                   style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.07)" }}>
                                {JSON.stringify(r.details, null, 2)}
                              </pre>
                            </div>
                          )}
                          {(r.itemCode || r.vendor || r.serialNo || r.qty || r.amount) && (
                            <div className="col-span-2 flex flex-wrap gap-3 text-[10px] text-slate-500 pt-1">
                              {r.itemCode && <span><span className="text-slate-600">Item:</span> <span className="text-slate-300 font-mono">{r.itemCode}</span> {r.itemName && <span className="text-slate-400">— {r.itemName}</span>}</span>}
                              {r.vendor   && <span><span className="text-slate-600">Vendor:</span> <span className="text-slate-300">{r.vendor}</span></span>}
                              {r.serialNo && <span><span className="text-slate-600">S/N:</span> <span className="text-slate-300 font-mono">{r.serialNo}</span></span>}
                              {r.qty      ? <span><span className="text-slate-600">Qty:</span> <span className="text-slate-300">{r.qty}</span></span> : null}
                              {r.amount   ? <span><span className="text-slate-600">Amount:</span> <span className="text-green-400 font-mono">₹{r.amount.toLocaleString("en-IN")}</span></span> : null}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="px-6 py-3 flex items-center justify-between flex-shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}>
        <div className="flex items-center gap-3 text-[11px] text-slate-500">
          <span>Rows per page:</span>
          <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
            className="bg-white/[0.04] border border-white/[0.08] rounded-lg px-2 py-1 text-xs text-slate-300 outline-none">
            {[10, 25, 50, 100, 250].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span>·</span>
          <span>{sorted.length === 0 ? 0 : safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, sorted.length)} of {sorted.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setPage(0)} disabled={safePage === 0}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            style={{ background: "rgba(255,255,255,0.05)" }}>⏮</button>
          <button onClick={() => setPage(Math.max(0, safePage - 1))} disabled={safePage === 0}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            style={{ background: "rgba(255,255,255,0.05)" }}>◀</button>
          <span className="px-3 py-1 text-xs text-slate-400">Page {safePage + 1} / {totalPages}</span>
          <button onClick={() => setPage(Math.min(totalPages - 1, safePage + 1))} disabled={safePage >= totalPages - 1}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            style={{ background: "rgba(255,255,255,0.05)" }}>▶</button>
          <button onClick={() => setPage(totalPages - 1)} disabled={safePage >= totalPages - 1}
            className="px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            style={{ background: "rgba(255,255,255,0.05)" }}>⏭</button>
        </div>
      </div>
    </div>
  );
}
