import React, { useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import { hashPassword, getRoleLabel, getRoleColor, fetchAllUsers } from "../auth/authStore.js";
import { appendAuditWithUser } from "../auth/auditStore.js";
import { isSupabaseEnabled } from "../config/env.js";
import { adminCreateUser, adminDeactivateUser, adminDeleteUser, adminResetPassword } from "../stores/adminApi.js";

function genId() {
  return "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const EMPTY_FORM = { mobile: "", username: "", password: "", role: "Admin", status: "active" };

export default function UserManagementPage({ canDo }) {
  const { currentUser, users, setUsers, roles } = useAuth();
  const [showModal, setShowModal]   = useState(false);
  const [editUser,  setEditUser]    = useState(null);
  const [form,      setForm]        = useState(EMPTY_FORM);
  const [errors,    setErrors]      = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [resetPw,   setResetPw]     = useState({ userId: null, pw: "", confirm: "" });
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState(null); // id of user whose status is being toggled
  const [deleteConfirm, setDeleteConfirm]   = useState(null);
  const [search, setSearch]         = useState("");
  const [toast,  setToast]          = useState(null);   // { text, type: 'success' | 'error' }

  const isSuperAdmin = currentUser?.role === "super_admin";

  const showToast = (text, type = "success") => {
    setToast({ text, type });
    setTimeout(() => setToast(null), 3000);
  };

  const openAdd = () => {
    setEditUser(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setShowModal(true);
  };

  const openEdit = (user) => {
    setEditUser(user);
    setForm({ mobile: user.mobile || "", username: user.username, password: "", role: user.role, status: user.status });
    setErrors({});
    setShowModal(true);
  };

  // Minimal validation — only what we can't recover from on the server.
  // Duplicate-username check is the one inline check we keep so the user gets immediate feedback.
  const validate = () => {
    const e = {};
    const u = form.username.trim().toLowerCase();
    if (!u) e.username = "Required";
    if (!editUser && !form.password) e.password = "Required";
    const dup = users.find((x) => x.username === u && x.id !== editUser?.id);
    if (dup) e.username = `Username "${u}" is already taken`;
    return e;
  };

  const handleSave = async () => {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }
    setSubmitting(true);
    try {
      if (editUser) {
        const username = form.username.trim().toLowerCase();
        const oldSnap = { mobile: editUser.mobile, username: editUser.username, role: editUser.role, status: editUser.status };
        const newSnap = { mobile: form.mobile.trim(), username, role: form.role, status: form.status };
        setUsers((prev) => prev.map((u) => u.id !== editUser.id ? u : {
          ...u, ...newSnap, fullName: username,
          ...(form.password ? { password: hashPassword(form.password) } : {}),
        }));
        appendAuditWithUser({
          type: "user_edit", module: "User Mgmt",
          action: `User Updated: ${username}`,
          ref: editUser.id, oldValue: oldSnap, newValue: newSnap,
          details: { passwordChanged: !!form.password },
        });
        showToast(`Updated ${username}`);
      } else if (isSupabaseEnabled()) {
        const username = form.username.trim().toLowerCase();
        const res = await adminCreateUser({
          username, password: form.password,
          mobile: form.mobile.trim(), roleKey: form.role, status: form.status,
        });
        if (!res.success) {
          console.error("[UserManagement] create-user failed:", res);
          // Deployment / network errors → toast (long text doesn't fit inline)
          // Field-shaped errors (validation, duplicate) → inline under username
          if (res.notDeployed) {
            showToast("Edge Function not deployed — run: supabase functions deploy admin-create-user", "error");
          } else if ((res.error || "").length > 80) {
            showToast(res.error, "error");
          } else {
            setErrors({ username: res.error || "Failed to create user" });
          }
          return;
        }
        const list = await fetchAllUsers(); if (list) setUsers(list);
        showToast(`Created ${username}`);
      } else {
        const username = form.username.trim().toLowerCase();
        const newUser = {
          id: genId(), username, fullName: username,
          mobile: form.mobile.trim(), password: hashPassword(form.password),
          role: form.role, status: form.status, lastLogin: null,
        };
        setUsers((prev) => [...prev, newUser]);
        appendAuditWithUser({
          type: "user_create", module: "User Mgmt",
          action: `User Created: ${username}`, ref: newUser.id,
          newValue: { username, role: newUser.role, status: newUser.status, mobile: newUser.mobile },
        });
        showToast(`Created ${username}`);
      }
      setShowModal(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (user) => {
    // GUARD: prevent duplicate concurrent invocations (idempotency)
    if (deleteSubmitting) return;
    if (user.role === "super_admin") return;
    setDeleteSubmitting(true);
    try {
      if (isSupabaseEnabled()) {
        console.log("[UserManagement] delete user", { id: user.id, username: user.username });
        const res = await adminDeleteUser({ userId: user.id });
        console.log("[UserManagement] adminDeleteUser response", res);
        if (!res.success) {
          // Do NOT touch local state on failure — operator sees the row stayed = the delete didn't happen
          showToast(`Delete failed: ${res.error}`, "error");
          return;
        }
        // SUCCESS — remove from local list IMMEDIATELY (don't wait for a refetch)
        // This guarantees the row disappears the moment the API confirms.
        setUsers((prev) => prev.filter((u) => u.id !== user.id));
        // Background sync to catch any other concurrent changes (best-effort, non-blocking)
        fetchAllUsers().then((list) => { if (list) setUsers(list); }).catch(() => {});
        if (res.note && res.note !== "User fully deleted") {
          console.warn("[UserManagement] delete note:", res.note);
        }
      } else {
        setUsers((prev) => prev.filter((u) => u.id !== user.id));
        appendAuditWithUser({
          type: "user_delete", module: "User Mgmt",
          action: `User Deleted: ${user.username}`,
          ref: user.id,
          oldValue: { username: user.username, role: user.role, status: user.status },
        });
      }
      showToast(`Deleted ${user.username}`);
      setDeleteConfirm(null);
    } finally {
      setDeleteSubmitting(false);
    }
  };

  const handleToggleStatus = async (user) => {
    // Idempotency: same user can't toggle twice while in flight
    if (statusBusyId === user.id) return;
    if (user.role === "super_admin") return;
    const newStatus = user.status === "active" ? "disabled" : "active";
    setStatusBusyId(user.id);
    // Optimistic UI update
    setUsers((prev) => prev.map((u) => u.id !== user.id ? u : { ...u, status: newStatus }));
    try {
      if (isSupabaseEnabled()) {
        const res = await adminDeactivateUser({ userId: user.id, status: newStatus });
        if (!res.success) {
          setUsers((prev) => prev.map((u) => u.id !== user.id ? u : { ...u, status: user.status }));
          showToast(`Status change failed: ${res.error}`, "error");
          return;
        }
      } else {
        appendAuditWithUser({
          type: newStatus === "disabled" ? "user_disabled" : "user_enabled",
          module: "User Mgmt",
          action: `User ${newStatus === "disabled" ? "Disabled" : "Enabled"}: ${user.username}`,
          ref: user.id, oldValue: { status: user.status }, newValue: { status: newStatus },
        });
      }
      showToast(`${user.username} → ${newStatus}`);
    } finally {
      setStatusBusyId(null);
    }
  };

  const openReset = (user) => {
    setResetPw({ userId: user.id, pw: "", confirm: "" });
    setResetSubmitting(false);
    setShowResetModal(true);
  };

  const handleResetPassword = async () => {
    // GUARD: prevent duplicate concurrent invocations (the #1 cause of multi-click symptom)
    if (resetSubmitting) return;
    if (!resetPw.pw) return;
    if (resetPw.pw !== resetPw.confirm) return;
    setResetSubmitting(true);                          // disable button immediately
    try {
      const user = users.find((u) => u.id === resetPw.userId);
      if (isSupabaseEnabled()) {
        const res = await adminResetPassword({ userId: resetPw.userId, newPassword: resetPw.pw });
        if (!res.success) { showToast(`Reset failed: ${res.error}`, "error"); return; }
      } else {
        setUsers((prev) => prev.map((u) => u.id !== resetPw.userId ? u : { ...u, password: hashPassword(resetPw.pw) }));
        appendAuditWithUser({
          type: "user_password_reset", module: "User Mgmt",
          action: `Password Reset (admin): ${user?.username || resetPw.userId}`,
          ref: resetPw.userId,
        });
      }
      showToast(`Password reset for ${user?.username || ""}`);
      setShowResetModal(false);
    } finally {
      setResetSubmitting(false);
    }
  };

  const roleOptions = [
    { value: "super_admin", label: "Super Admin" },
    ...Object.entries(roles).map(([k, v]) => ({ value: k, label: v.label })),
  ];

  const filtered = users.filter((u) =>
    !search ||
    String(u.username || "").toLowerCase().includes(search.toLowerCase()) ||
    getRoleLabel(u, roles).toLowerCase().includes(search.toLowerCase())
  );

  const fmtDate = (iso) => {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
  };

  const inputCls = "w-full px-3 py-2 rounded-lg text-sm text-white placeholder-slate-600 outline-none transition-all";
  const inputStyle = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[60] flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl"
             style={{
               background: toast.type === "error" ? "rgba(239,68,68,0.15)" : "rgba(34,197,94,0.15)",
               border: `1px solid ${toast.type === "error" ? "rgba(239,68,68,0.4)" : "rgba(34,197,94,0.4)"}`,
               color: toast.type === "error" ? "#fca5a5" : "#86efac",
               animation: "slideUp 0.2s ease both",
             }}>
          <span>{toast.type === "error" ? "❌" : "✅"}</span>
          <span className="text-xs font-semibold">{toast.text}</span>
        </div>
      )}

      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div>
          <div className="text-base font-bold text-white">User Management</div>
          <div className="text-xs text-slate-500 mt-0.5">{users.length} user{users.length !== 1 ? "s" : ""} in the system</div>
        </div>
        <div className="flex items-center gap-3">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users…"
            className="px-3 py-1.5 rounded-lg text-xs text-white placeholder-slate-600 outline-none w-44"
            style={inputStyle} />
          {(isSuperAdmin || canDo?.("users", "create")) && (
            <button onClick={openAdd}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white transition-all"
              style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)", boxShadow: "0 4px 12px rgba(99,102,241,0.35)" }}>
              + Add User
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                <th className="px-4 py-3 text-left font-semibold text-slate-400">Username</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-400">Mobile</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-400">Role</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-400">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-400">Last Login</th>
                <th className="px-4 py-3 text-right font-semibold text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((user) => {
                const rLabel = getRoleLabel(user, roles);
                const rColor = getRoleColor(user, roles);
                const isSelf = user.id === currentUser?.id;
                const isSA   = user.role === "super_admin";
                return (
                  <tr key={user.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                      onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.02)"}
                      onMouseLeave={(e) => e.currentTarget.style.background = ""}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black text-white flex-shrink-0"
                             style={{ background: `linear-gradient(135deg,${rColor}80,${rColor}40)` }}>
                          {user.username.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="font-mono font-semibold text-white">{user.username}</div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-300">{user.mobile || "—"}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: rColor + "22", color: rColor }}>{rLabel}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${user.status === "active" ? "text-emerald-400" : "text-slate-500"}`}
                            style={{ background: user.status === "active" ? "rgba(52,211,153,0.12)" : "rgba(148,163,184,0.12)" }}>
                        {user.status === "active" ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(user.lastLogin)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 justify-end">
                        {(isSuperAdmin || canDo?.("users", "edit")) && (
                          <button onClick={() => openEdit(user)}
                            className="px-2.5 py-1 rounded-lg text-[10px] font-medium text-slate-300 hover:text-white transition-all"
                            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}>
                            Edit
                          </button>
                        )}
                        {(isSuperAdmin || canDo?.("users", "edit")) && (
                          <button onClick={() => openReset(user)}
                            className="px-2.5 py-1 rounded-lg text-[10px] font-medium text-blue-400 hover:text-blue-300 transition-all"
                            style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)" }}>
                            Reset PW
                          </button>
                        )}
                        {!isSelf && !isSA && (isSuperAdmin || canDo?.("users", "edit")) && (
                          <button onClick={() => handleToggleStatus(user)}
                            disabled={statusBusyId === user.id}
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all ${user.status === "active" ? "text-amber-400 hover:text-amber-300" : "text-emerald-400 hover:text-emerald-300"}`}
                            style={{
                              background: user.status === "active" ? "rgba(251,191,36,0.08)" : "rgba(52,211,153,0.08)",
                              border: `1px solid ${user.status === "active" ? "rgba(251,191,36,0.2)" : "rgba(52,211,153,0.2)"}`,
                              opacity: statusBusyId === user.id ? 0.5 : 1,
                              cursor: statusBusyId === user.id ? "wait" : "pointer",
                            }}
                          >
                            {statusBusyId === user.id ? "…" : (user.status === "active" ? "Disable" : "Enable")}
                          </button>
                        )}
                        {!isSelf && !isSA && (isSuperAdmin || canDo?.("users", "delete")) && (
                          <button onClick={() => setDeleteConfirm(user)}
                            className="px-2.5 py-1 rounded-lg text-[10px] font-medium text-red-400 hover:text-red-300 transition-all"
                            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-600 text-xs">No users found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
             onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div className="w-full max-w-md rounded-2xl p-6 mx-4" style={{ background: "#0e1118", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 32px 80px rgba(0,0,0,0.8)" }}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-white text-sm">{editUser ? "Edit User" : "Add New User"}</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-500 hover:text-white transition-colors text-lg leading-none">✕</button>
            </div>

            <form onSubmit={(ev) => { ev.preventDefault(); if (!submitting) handleSave(); }} className="space-y-3.5">
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">Username *</label>
                <input value={form.username} autoFocus
                  onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.toLowerCase().replace(/[^a-z0-9_.\-]/g, "") }))}
                  placeholder="e.g. mihir or john_doe" className={inputCls + " font-mono"} style={inputStyle}
                  disabled={!!editUser} />
                {editUser && <div className="text-[10px] text-slate-600 mt-1">Username cannot be changed after creation</div>}
                {errors.username && <div className="text-red-400 text-[10px] mt-1">{errors.username}</div>}
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">Mobile Number</label>
                <input value={form.mobile} onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))}
                  placeholder="e.g. 9876543210" className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">
                  {editUser ? "New Password (leave blank to keep current)" : "Password *"}
                </label>
                <input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder={editUser ? "Leave blank to keep current" : "Enter password"} className={inputCls} style={inputStyle} />
                {errors.password && <div className="text-red-400 text-[10px] mt-1">{errors.password}</div>}
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">Role *</label>
                <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  className={inputCls} style={inputStyle}>
                  {roleOptions.map((r) => (
                    <option key={r.value} value={r.value} style={{ background: "#0e1118" }}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">Status</label>
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  className={inputCls} style={inputStyle}>
                  <option value="active" style={{ background: "#0e1118" }}>Active</option>
                  <option value="disabled" style={{ background: "#0e1118" }}>Disabled</option>
                </select>
              </div>

              <div className="flex gap-2.5 pt-2">
                <button type="button" onClick={() => setShowModal(false)} disabled={submitting}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-all"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  Cancel
                </button>
                <button type="submit" disabled={submitting}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold text-white transition-all"
                  style={{
                    background: submitting ? "rgba(99,102,241,0.4)" : "linear-gradient(135deg,#3b82f6,#6366f1)",
                    boxShadow: submitting ? "none" : "0 4px 12px rgba(99,102,241,0.35)",
                    cursor: submitting ? "wait" : "pointer",
                  }}>
                  {submitting ? "Saving…" : (editUser ? "Save Changes" : "Create User")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
             onClick={(e) => { if (!resetSubmitting && e.target === e.currentTarget) setShowResetModal(false); }}>
          <div className="w-full max-w-sm rounded-2xl p-6 mx-4" style={{ background: "#0e1118", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 32px 80px rgba(0,0,0,0.8)" }}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-white text-sm">Reset Password</h3>
              <button onClick={() => !resetSubmitting && setShowResetModal(false)} className="text-slate-500 hover:text-white transition-colors text-lg leading-none">✕</button>
            </div>
            <form onSubmit={(ev) => { ev.preventDefault(); ev.stopPropagation(); if (!resetSubmitting) handleResetPassword(); }} className="space-y-3.5">
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">New Password</label>
                <input type="password" autoFocus value={resetPw.pw}
                  onChange={(e) => setResetPw((r) => ({ ...r, pw: e.target.value }))}
                  disabled={resetSubmitting}
                  placeholder="Enter new password" className={inputCls} style={inputStyle} />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">Confirm Password</label>
                <input type="password" value={resetPw.confirm}
                  onChange={(e) => setResetPw((r) => ({ ...r, confirm: e.target.value }))}
                  disabled={resetSubmitting}
                  placeholder="Repeat password" className={inputCls} style={inputStyle} />
                {resetPw.confirm && resetPw.pw !== resetPw.confirm && (
                  <div className="text-red-400 text-[10px] mt-1">Passwords do not match</div>
                )}
              </div>
              <div className="flex gap-2.5 pt-2">
                <button type="button" onClick={() => !resetSubmitting && setShowResetModal(false)} disabled={resetSubmitting}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-all"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", opacity: resetSubmitting ? 0.5 : 1 }}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetSubmitting || !resetPw.pw || resetPw.pw !== resetPw.confirm}
                  onClick={(ev) => {
                    // Belt-and-braces: in addition to <form onSubmit>, run the handler from the
                    // button's onClick too. This guarantees one click triggers the action even if
                    // the form-submit event is intercepted by something else in the React tree.
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (!resetSubmitting && resetPw.pw && resetPw.pw === resetPw.confirm) {
                      handleResetPassword();
                    }
                  }}
                  className="flex-1 py-2 rounded-xl text-xs font-semibold text-white transition-all flex items-center justify-center gap-2"
                  style={{
                    background: "linear-gradient(135deg,#3b82f6,#6366f1)",
                    opacity: (resetSubmitting || !resetPw.pw || resetPw.pw !== resetPw.confirm) ? 0.5 : 1,
                    cursor: resetSubmitting ? "wait" : (!resetPw.pw || resetPw.pw !== resetPw.confirm) ? "not-allowed" : "pointer",
                  }}
                >
                  {resetSubmitting && (
                    <span className="inline-block w-3 h-3 rounded-full animate-spin" style={{ border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff" }} />
                  )}
                  {resetSubmitting ? "Resetting…" : "Reset Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
             onClick={(e) => { if (!deleteSubmitting && e.target === e.currentTarget) setDeleteConfirm(null); }}>
          <div className="w-full max-w-sm rounded-2xl p-6 mx-4" style={{ background: "#0e1118", border: "1px solid rgba(239,68,68,0.25)", boxShadow: "0 32px 80px rgba(0,0,0,0.8)" }}>
            <div className="text-center">
              <div className="text-3xl mb-3">⚠️</div>
              <h3 className="font-bold text-white text-sm mb-2">Delete User?</h3>
              <p className="text-xs text-slate-400">Delete <span className="text-white font-mono font-semibold">{deleteConfirm.username}</span>? This cannot be undone.</p>
            </div>
            <div className="flex gap-2.5 mt-6">
              <button
                type="button"
                onClick={() => { if (!deleteSubmitting) setDeleteConfirm(null); }}
                disabled={deleteSubmitting}
                className="flex-1 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-all"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", opacity: deleteSubmitting ? 0.5 : 1 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={(ev) => {
                  // Stop event propagation so it can't bubble to the backdrop click handler
                  ev.preventDefault();
                  ev.stopPropagation();
                  // The idempotency guard inside handleDelete is the authoritative protection;
                  // disabled prop is a UI hint only.
                  if (!deleteSubmitting) handleDelete(deleteConfirm);
                }}
                disabled={deleteSubmitting}
                className="flex-1 py-2 rounded-xl text-xs font-semibold text-white transition-all flex items-center justify-center gap-2"
                style={{
                  background: "linear-gradient(135deg,#ef4444,#dc2626)",
                  boxShadow: deleteSubmitting ? "none" : "0 4px 12px rgba(239,68,68,0.35)",
                  opacity: deleteSubmitting ? 0.6 : 1,
                  cursor: deleteSubmitting ? "wait" : "pointer",
                }}
              >
                {deleteSubmitting && (
                  <span className="inline-block w-3 h-3 rounded-full animate-spin" style={{ border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff" }} />
                )}
                {deleteSubmitting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
