import React, { useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import { DEFAULT_ROLES } from "../auth/authStore.js";
import { appendAuditWithUser } from "../auth/auditStore.js";

const ALL_MODULES = [
  { key: "inventory", label: "Item Master",     actions: ["add", "edit", "delete", "adjust"] },
  { key: "pipeline",  label: "Purchase Orders", actions: ["create", "approve", "reject", "ordered", "receive", "delete"] },
  { key: "outward",   label: "BOM / Outward",   actions: ["bom", "manual", "editBOM"] },
  { key: "machines",  label: "Machine Tracker", actions: ["updateStage"] },
  { key: "vendors",   label: "Vendors",         actions: ["add", "edit", "delete"] },
  { key: "inward",    label: "Inward",          actions: ["submit"] },
  { key: "pending",   label: "Pending Stock",   actions: ["fulfill", "clear"] },
  { key: "users",     label: "User Mgmt",       actions: ["view", "create", "edit", "delete"] },
  { key: "roles",     label: "Role Mgmt",       actions: ["view", "create", "edit", "delete"] },
];

const ALL_PAGES = [
  "dashboard", "inventory", "inward", "outward", "pending",
  "pipeline", "machines", "vendors", "analytics", "ai", "history", "audit", "settings", "users", "roles",
];

const PAGE_LABELS = {
  dashboard: "Dashboard", inventory: "Item Master", inward: "Inward", outward: "BOM/Outward",
  pending: "Pending Stock", pipeline: "Order Pipeline", machines: "Machine Tracker",
  vendors: "Vendors", analytics: "Analytics", ai: "AI Assistant", history: "History & Reports",
  audit: "Audit Trail", settings: "Settings", users: "User Management", roles: "Role Management",
};

const COLORS = ["#6366f1","#3b82f6","#22c55e","#f59e0b","#ec4899","#14b8a6","#8b5cf6","#f97316"];
const ICONS  = ["👑","🛒","📦","🔧","🔑","📊","🏭","⚙️","👤","🔐"];

function makeEmptyRole() {
  const actions = {};
  ALL_MODULES.forEach((m) => {
    actions[m.key] = {};
    m.actions.forEach((a) => { actions[m.key][a] = false; });
  });
  return {
    label: "", icon: "👤", color: "#6366f1", badge: "",
    pages: ["dashboard"],
    actions,
  };
}

export default function RoleManagementPage({ canDo }) {
  const { currentUser, roles, setRoles, createRoleSupa, updateRoleSupa, deleteRoleSupa } = useAuth();
  const isSuperAdmin = currentUser?.role === "super_admin";

  const [editKey,    setEditKey]    = useState(null);
  const [editForm,   setEditForm]   = useState(null);
  const [showModal,  setShowModal]  = useState(false);
  const [isNew,      setIsNew]      = useState(false);
  const [newRoleKey, setNewRoleKey] = useState("");
  const [keyErr,     setKeyErr]     = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [activeTab,  setActiveTab]  = useState("pages");

  const canEdit = isSuperAdmin || canDo?.("roles", "edit");
  const canCreate = isSuperAdmin || canDo?.("roles", "create");
  const canDelete = isSuperAdmin || canDo?.("roles", "delete");

  const openEdit = (key, role) => {
    const conf = JSON.parse(JSON.stringify(role));
    ALL_MODULES.forEach((m) => {
      if (!conf.actions) conf.actions = {};
      if (!conf.actions[m.key]) conf.actions[m.key] = {};
      m.actions.forEach((a) => { if (conf.actions[m.key][a] === undefined) conf.actions[m.key][a] = false; });
    });
    setEditKey(key);
    setEditForm(conf);
    setIsNew(false);
    setNewRoleKey(key);
    setKeyErr("");
    setActiveTab("pages");
    setShowModal(true);
  };

  const openAdd = () => {
    setEditKey(null);
    setEditForm(makeEmptyRole());
    setIsNew(true);
    setNewRoleKey("");
    setKeyErr("");
    setActiveTab("pages");
    setShowModal(true);
  };

  const togglePage = (page) => {
    setEditForm((f) => {
      const has = f.pages.includes(page);
      return { ...f, pages: has ? f.pages.filter((p) => p !== page) : [...f.pages, page] };
    });
  };

  const toggleAction = (module, action) => {
    setEditForm((f) => ({
      ...f,
      actions: { ...f.actions, [module]: { ...f.actions[module], [action]: !f.actions[module][action] } },
    }));
  };

  const handleSave = async () => {
    if (!editForm.label.trim()) return;
    const key = isNew ? newRoleKey.trim() : editKey;
    if (!key) { setKeyErr("Role name/key is required"); return; }
    if (isNew && roles[key]) { setKeyErr("A role with this key already exists"); return; }
    const oldRole = roles[key] || null;
    const newRole = { ...editForm, label: editForm.label.trim(), badge: editForm.badge.trim() || editForm.label.trim() };
    // AWAIT Supabase persistence — only update UI on success (B3 fix)
    const op  = isNew ? createRoleSupa : updateRoleSupa;
    const res = await op(key, newRole);
    if (!res?.success) { setKeyErr(res?.error || "Failed to save role"); return; }
    appendAuditWithUser({
      type: isNew ? "role_create" : "role_edit", module: "Role Mgmt",
      action: isNew ? `Role Created: ${newRole.label}` : `Role Updated: ${newRole.label}`,
      ref: key,
      oldValue: oldRole ? { label: oldRole.label, pages: oldRole.pages, actions: oldRole.actions } : null,
      newValue: { label: newRole.label, pages: newRole.pages, actions: newRole.actions },
    });
    setShowModal(false);
  };

  const handleDelete = async (key) => {
    const old = roles[key];
    const res = await deleteRoleSupa(key);
    if (!res?.success) { alert("Failed to delete role: " + (res?.error || "unknown")); return; }
    appendAuditWithUser({
      type: "role_delete", module: "Role Mgmt",
      action: `Role Deleted: ${old?.label || key}`,
      ref: key,
      oldValue: old ? { label: old.label, pages: old.pages, actions: old.actions } : null,
    });
    setDeleteConfirm(null);
  };

  const handleReset = async () => {
    // For each default role: if it exists → update; if not → create.
    // Skips super_admin (system row). Awaits each Supabase write.
    const failures = [];
    for (const [key, role] of Object.entries(DEFAULT_ROLES)) {
      if (key === "super_admin") continue; // system row — never overwrite via reset
      const op = roles[key] ? updateRoleSupa : createRoleSupa;
      const res = await op(key, role);
      if (!res?.success) failures.push({ key, error: res?.error });
    }
    if (failures.length) {
      alert(`Reset partially failed for ${failures.length} role(s):\n` +
            failures.map(f => `  • ${f.key}: ${f.error}`).join("\n"));
      return;
    }
    appendAuditWithUser({
      type: "role_reset", module: "Role Mgmt",
      action: "Roles reset to defaults",
      ref: "all",
    });
  };

  const inputCls = "w-full px-3 py-2 rounded-lg text-sm text-white placeholder-slate-600 outline-none transition-all";
  const inputStyle = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div>
          <div className="text-base font-bold text-white">Role Management</div>
          <div className="text-xs text-slate-500 mt-0.5">{Object.keys(roles).length} role{Object.keys(roles).length !== 1 ? "s" : ""} configured</div>
        </div>
        <div className="flex items-center gap-2.5">
          {isSuperAdmin && (
            <button onClick={handleReset}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white transition-all"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
              Reset to Defaults
            </button>
          )}
          {canCreate && (
            <button onClick={openAdd}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
              style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)", boxShadow: "0 4px 12px rgba(99,102,241,0.35)" }}>
              + New Role
            </button>
          )}
        </div>
      </div>

      {/* Role Cards */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {/* Super Admin — always shown, not editable */}
          <div className="rounded-2xl p-5" style={{ background: "rgba(236,72,153,0.06)", border: "1px solid rgba(236,72,153,0.2)" }}>
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🔑</span>
                <div>
                  <div className="font-bold text-white text-sm">Super Admin</div>
                  <div className="text-[10px] mt-0.5" style={{ color: "#ec4899" }}>Full System Access</div>
                </div>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[9px] font-bold text-pink-300 uppercase tracking-wide" style={{ background: "rgba(236,72,153,0.15)" }}>Built-in</span>
            </div>
            <p className="text-xs text-slate-500">Unrestricted access to all modules and settings. Cannot be modified.</p>
          </div>

          {Object.entries(roles).map(([key, role]) => (
            <div key={key} className="rounded-2xl p-5" style={{ background: `${role.color}08`, border: `1px solid ${role.color}28` }}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{role.icon}</span>
                  <div>
                    <div className="font-bold text-white text-sm">{role.label}</div>
                    <div className="text-[10px] mt-0.5" style={{ color: role.color }}>{role.badge}</div>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  {canEdit && (
                    <button onClick={() => openEdit(key, role)}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-medium text-slate-300 hover:text-white transition-all"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                      Edit
                    </button>
                  )}
                  {canDelete && (
                    <button onClick={() => setDeleteConfirm(key)}
                      className="px-2.5 py-1 rounded-lg text-[10px] font-medium text-red-400 hover:text-red-300 transition-all"
                      style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                      Delete
                    </button>
                  )}
                </div>
              </div>
              <div className="mb-3">
                <div className="text-[10px] text-slate-500 mb-1.5 font-medium">Pages ({(role.pages || []).length})</div>
                <div className="flex flex-wrap gap-1">
                  {(role.pages || []).map((p) => (
                    <span key={p} className="px-1.5 py-0.5 rounded text-[9px] text-slate-300" style={{ background: "rgba(255,255,255,0.07)" }}>{PAGE_LABELS[p] || p}</span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Edit/Add Modal */}
      {showModal && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-2xl rounded-2xl flex flex-col mx-4" style={{ background: "#0e1118", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 32px 80px rgba(0,0,0,0.8)", maxHeight: "90vh" }}>
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <h3 className="font-bold text-white text-sm">{isNew ? "New Role" : `Edit: ${editForm.label}`}</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-500 hover:text-white transition-colors text-lg leading-none">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="col-span-2">
                  <label className="block text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">Role Label *</label>
                  <input value={editForm.label} onChange={(e) => setEditForm((f) => ({ ...f, label: e.target.value }))}
                    placeholder="e.g. Purchase Manager" className={inputCls} style={inputStyle} />
                </div>
                {isNew && (
                  <div className="col-span-2">
                    <label className="block text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">Role Key (unique) *</label>
                    <input value={newRoleKey} onChange={(e) => { setNewRoleKey(e.target.value); setKeyErr(""); }}
                      placeholder="e.g. Purchase Manager" className={inputCls} style={inputStyle} />
                    {keyErr && <div className="text-red-400 text-[10px] mt-1">{keyErr}</div>}
                  </div>
                )}
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">Badge Text</label>
                  <input value={editForm.badge} onChange={(e) => setEditForm((f) => ({ ...f, badge: e.target.value }))}
                    placeholder="e.g. Full Access" className={inputCls} style={inputStyle} />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">Icon</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {ICONS.map((ic) => (
                      <button key={ic} onClick={() => setEditForm((f) => ({ ...f, icon: ic }))}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-base transition-all"
                        style={{ background: editForm.icon === ic ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.05)", border: editForm.icon === ic ? "1px solid rgba(99,102,241,0.6)" : "1px solid rgba(255,255,255,0.08)" }}>
                        {ic}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">Color</label>
                  <div className="flex gap-1.5">
                    {COLORS.map((c) => (
                      <button key={c} onClick={() => setEditForm((f) => ({ ...f, color: c }))}
                        className="w-7 h-7 rounded-full transition-all"
                        style={{ background: c, boxShadow: editForm.color === c ? `0 0 0 3px ${c}40, 0 0 0 2px ${c}` : "none" }} />
                    ))}
                  </div>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 mb-4 p-1 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
                {["pages", "actions"].map((tab) => (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    className="flex-1 py-1.5 rounded-md text-xs font-semibold transition-all capitalize"
                    style={{ background: activeTab === tab ? "rgba(255,255,255,0.1)" : "transparent", color: activeTab === tab ? "#fff" : "#64748b" }}>
                    {tab === "pages" ? "Page Access" : "Action Permissions"}
                  </button>
                ))}
              </div>

              {activeTab === "pages" && (
                <div className="grid grid-cols-2 gap-2">
                  {ALL_PAGES.map((page) => (
                    <label key={page} className="flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all"
                           style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                      <input type="checkbox" checked={(editForm.pages || []).includes(page)} onChange={() => togglePage(page)}
                        className="rounded" style={{ accentColor: editForm.color }} />
                      <span className="text-xs text-slate-300">{PAGE_LABELS[page] || page}</span>
                    </label>
                  ))}
                </div>
              )}

              {activeTab === "actions" && (
                <div className="space-y-4">
                  {ALL_MODULES.map((mod) => (
                    <div key={mod.key} className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="text-xs font-semibold text-white mb-3">{mod.label}</div>
                      <div className="flex flex-wrap gap-2">
                        {mod.actions.map((action) => {
                          const checked = editForm.actions?.[mod.key]?.[action] ?? false;
                          return (
                            <label key={action} className="flex items-center gap-1.5 cursor-pointer px-2.5 py-1.5 rounded-lg transition-all"
                                   style={{ background: checked ? `${editForm.color}15` : "rgba(255,255,255,0.04)", border: `1px solid ${checked ? editForm.color + "40" : "rgba(255,255,255,0.08)"}` }}>
                              <input type="checkbox" checked={checked} onChange={() => toggleAction(mod.key, action)}
                                className="rounded" style={{ accentColor: editForm.color }} />
                              <span className="text-[11px] text-slate-300 capitalize">{action}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex gap-2.5 px-6 py-4 flex-shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              <button onClick={() => setShowModal(false)}
                className="flex-1 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-all"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                Cancel
              </button>
              <button onClick={handleSave} disabled={!editForm.label.trim() || (isNew && !newRoleKey.trim())}
                className="flex-1 py-2 rounded-xl text-xs font-semibold text-white transition-all"
                style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)", boxShadow: "0 4px 12px rgba(99,102,241,0.35)", opacity: (!editForm.label.trim() || (isNew && !newRoleKey.trim())) ? 0.4 : 1 }}>
                {isNew ? "Create Role" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-sm rounded-2xl p-6 mx-4" style={{ background: "#0e1118", border: "1px solid rgba(239,68,68,0.25)", boxShadow: "0 32px 80px rgba(0,0,0,0.8)" }}>
            <div className="text-center">
              <div className="text-3xl mb-3">⚠️</div>
              <h3 className="font-bold text-white text-sm mb-2">Delete Role?</h3>
              <p className="text-xs text-slate-400">Delete role <span className="text-white font-semibold">{roles[deleteConfirm]?.label}</span>? Users with this role will lose access.</p>
            </div>
            <div className="flex gap-2.5 mt-6">
              <button onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-all"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                Cancel
              </button>
              <button onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 py-2 rounded-xl text-xs font-semibold text-white transition-all"
                style={{ background: "linear-gradient(135deg,#ef4444,#dc2626)", boxShadow: "0 4px 12px rgba(239,68,68,0.35)" }}>
                Delete Role
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
