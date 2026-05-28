import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import { hashPassword, checkPassword } from "../auth/authStore.js";
import { appendAuditWithUser } from "../auth/auditStore.js";

function fmtDateTime(iso) {
  if (!iso) return "Never";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

export default function UserProfileMenu({ collapsed = false }) {
  const { currentUser, logout, roleLabel, roleColor, roleIcon, setUsers } = useAuth();
  const [isOpen,            setIsOpen]            = useState(false);
  const [showProfileModal,  setShowProfileModal]  = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const triggerRef  = useRef(null);
  const dropdownRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target) &&
        triggerRef.current  && !triggerRef.current.contains(e.target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === "Escape") setIsOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen]);

  if (!currentUser) return null;

  const initials  = currentUser.fullName.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase() || "U";
  const isSA      = currentUser.role === "super_admin";

  return (
    <>
      {/* Trigger */}
      <button
        ref={triggerRef}
        onClick={() => setIsOpen((v) => !v)}
        className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-xl transition-all ${collapsed ? "justify-center" : ""} ${isOpen ? "bg-white/[0.06]" : "hover:bg-white/[0.04]"}`}
        title={collapsed ? `${currentUser.fullName} — ${roleLabel}` : ""}
      >
        {/* Avatar */}
        <div className="relative flex-shrink-0">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-[11px] font-black select-none"
            style={{
              background: `linear-gradient(135deg,${roleColor},${roleColor}aa)`,
              boxShadow: `0 2px 10px ${roleColor}50`,
            }}
          >
            {initials}
          </div>
          <div
            className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-[2px]"
            style={{ borderColor: "#090b11" }}
          />
        </div>

        {!collapsed && (
          <>
            <div className="flex-1 min-w-0 text-left">
              <div className="text-[11px] font-black text-white truncate leading-none">{currentUser.fullName}</div>
              <div className="text-[9px] font-semibold mt-0.5 leading-none truncate" style={{ color: roleColor }}>
                {roleLabel}
              </div>
            </div>
            <span
              className="text-slate-600 text-[9px] flex-shrink-0 transition-transform duration-200"
              style={{ transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}
            >
              ▲
            </span>
          </>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Mobile overlay */}
          <div
            className="fixed inset-0 z-40 md:hidden"
            style={{ background: "rgba(0,0,0,0.3)" }}
            onClick={() => setIsOpen(false)}
          />

          <div
            ref={dropdownRef}
            className="absolute z-50 rounded-2xl overflow-hidden user-menu-anim"
            style={{
              bottom: "calc(100% + 6px)",
              left:   collapsed ? "calc(100% + 8px)" : 8,
              right:  collapsed ? "auto" : 8,
              width:  collapsed ? 260 : "auto",
              minWidth: 240,
              background: "#0d1119",
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow: "0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(0,0,0,0.4)",
              transformOrigin: collapsed ? "bottom left" : "bottom center",
            }}
          >
            {/* User Info Header */}
            <div className="p-4" style={{ background: `linear-gradient(135deg,${roleColor}15,${roleColor}05)`, borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
              <div className="flex items-center gap-3 mb-3">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-black flex-shrink-0"
                  style={{ background: `linear-gradient(135deg,${roleColor},${roleColor}aa)`, boxShadow: `0 4px 14px ${roleColor}40` }}
                >
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-bold text-white truncate">{currentUser.fullName}</div>
                  <div className="text-[10px] text-slate-500 truncate font-mono">@{currentUser.username}</div>
                </div>
              </div>

              {/* Info rows */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">Role</span>
                  <span className="flex items-center gap-1 font-semibold" style={{ color: roleColor }}>
                    <span>{roleIcon}</span>
                    <span>{roleLabel}</span>
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-500">Last Login</span>
                  <span className="text-slate-300 font-medium">{fmtDateTime(currentUser.lastLogin)}</span>
                </div>
                {currentUser.mobile && (
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-slate-500">Mobile</span>
                    <span className="text-slate-300 font-medium">{currentUser.mobile}</span>
                  </div>
                )}
              </div>

              {isSA && (
                <div className="mt-3 px-2 py-1 rounded-md text-[9px] font-bold text-center uppercase tracking-wider"
                     style={{ background: "rgba(236,72,153,0.15)", color: "#ec4899" }}>
                  Super Administrator
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="py-1.5">
              <MenuItem
                icon="👤"
                label="My Profile"
                desc="View and edit your profile"
                onClick={() => { setIsOpen(false); setShowProfileModal(true); }}
              />
              <MenuItem
                icon="🔐"
                label="Change Password"
                desc="Update your password"
                onClick={() => { setIsOpen(false); setShowPasswordModal(true); }}
              />
              <div className="my-1 mx-3" style={{ height: 1, background: "rgba(255,255,255,0.06)" }} />
              <MenuItem
                icon="⏻"
                label="Sign Out"
                desc="End your session"
                danger
                onClick={() => { setIsOpen(false); logout(); }}
              />
            </div>
          </div>

          <style>{`
            @keyframes userMenuIn {
              from { opacity: 0; transform: translateY(6px) scale(0.97); }
              to   { opacity: 1; transform: translateY(0)   scale(1);    }
            }
            .user-menu-anim {
              animation: userMenuIn 160ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
            }
          `}</style>
        </>
      )}

      {/* My Profile Modal */}
      {showProfileModal && (
        <ProfileModal
          user={currentUser}
          roleLabel={roleLabel}
          roleColor={roleColor}
          onClose={() => setShowProfileModal(false)}
          onSave={(updates) => {
            const oldSnap = { fullName: currentUser.fullName, mobile: currentUser.mobile };
            setUsers((prev) => prev.map((u) => u.id !== currentUser.id ? u : { ...u, ...updates }));
            appendAuditWithUser({
              type: "profile_update", module: "Auth",
              action: `Profile updated by ${currentUser.fullName}`,
              ref: currentUser.id,
              oldValue: oldSnap, newValue: updates,
            });
            setShowProfileModal(false);
          }}
        />
      )}

      {/* Change Password Modal */}
      {showPasswordModal && (
        <ChangePasswordModal
          user={currentUser}
          onClose={() => setShowPasswordModal(false)}
          onSave={(newPassword) => {
            setUsers((prev) => prev.map((u) => u.id !== currentUser.id ? u : { ...u, password: hashPassword(newPassword) }));
            appendAuditWithUser({
              type: "password_change", module: "Auth",
              action: `Password changed by ${currentUser.fullName}`,
              ref: currentUser.id,
            });
            setShowPasswordModal(false);
          }}
        />
      )}
    </>
  );
}

// ─── Menu Item ───────────────────────────────────────────────────────────────
function MenuItem({ icon, label, desc, onClick, danger = false }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2 transition-colors group"
      onMouseEnter={(e) => e.currentTarget.style.background = danger ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.05)"}
      onMouseLeave={(e) => e.currentTarget.style.background = ""}
    >
      <span
        className="w-8 h-8 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
        style={{
          background: danger ? "rgba(239,68,68,0.1)" : "rgba(255,255,255,0.04)",
          color: danger ? "#ef4444" : "#94a3b8",
        }}
      >
        {icon}
      </span>
      <div className="flex-1 text-left min-w-0">
        <div className={`text-[12px] font-semibold leading-tight ${danger ? "text-red-400" : "text-white"}`}>
          {label}
        </div>
        <div className="text-[9px] text-slate-600 mt-0.5 leading-tight truncate">{desc}</div>
      </div>
      <span className={`text-[10px] flex-shrink-0 transition-transform group-hover:translate-x-0.5 ${danger ? "text-red-400" : "text-slate-700"}`}>
        →
      </span>
    </button>
  );
}

// ─── My Profile Modal ────────────────────────────────────────────────────────
function ProfileModal({ user, roleLabel, roleColor, onClose, onSave }) {
  const [fullName, setFullName] = useState(user.fullName);
  const [mobile,   setMobile]   = useState(user.mobile || "");
  const [errors,   setErrors]   = useState({});

  const inputCls   = "w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-slate-600 outline-none transition-all";
  const inputStyle = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" };
  const initials = fullName.split(" ").map((s) => s[0]).join("").slice(0, 2).toUpperCase() || "U";

  const handleSave = () => {
    const e = {};
    if (!fullName.trim()) e.fullName = "Required";
    if (Object.keys(e).length) { setErrors(e); return; }
    onSave({ fullName: fullName.trim(), mobile: mobile.trim() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden user-menu-anim"
           style={{ background: "#0e1118", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 32px 80px rgba(0,0,0,0.8)" }}>
        {/* Header */}
        <div className="p-5" style={{ background: `linear-gradient(135deg,${roleColor}18,${roleColor}05)`, borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-white text-sm">My Profile</h3>
            <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors text-lg leading-none">✕</button>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-base font-black"
                 style={{ background: `linear-gradient(135deg,${roleColor},${roleColor}aa)`, boxShadow: `0 4px 16px ${roleColor}40` }}>
              {initials}
            </div>
            <div>
              <div className="text-sm font-bold text-white">{fullName || user.fullName}</div>
              <div className="text-[10px] text-slate-500 font-mono">@{user.username}</div>
              <div className="text-[10px] font-semibold mt-1" style={{ color: roleColor }}>{roleLabel}</div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3.5">
          <div>
            <label className="block text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">Full Name *</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputCls} style={inputStyle} />
            {errors.fullName && <div className="text-red-400 text-[10px] mt-1">{errors.fullName}</div>}
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">Mobile</label>
            <input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="e.g. 9876543210"
                   className={inputCls} style={inputStyle} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">Username</label>
            <input value={user.username} disabled className={inputCls}
                   style={{ ...inputStyle, opacity: 0.5, cursor: "not-allowed" }} />
            <div className="text-[10px] text-slate-600 mt-1">Username cannot be changed</div>
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">Role</label>
            <input value={roleLabel} disabled className={inputCls}
                   style={{ ...inputStyle, opacity: 0.5, cursor: "not-allowed" }} />
            <div className="text-[10px] text-slate-600 mt-1">Contact admin to change role</div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2.5 p-5" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <button onClick={onClose}
            className="flex-1 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-all"
            style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
            Cancel
          </button>
          <button onClick={handleSave}
            className="flex-1 py-2 rounded-xl text-xs font-semibold text-white transition-all"
            style={{ background: "linear-gradient(135deg,#3b82f6,#6366f1)", boxShadow: "0 4px 12px rgba(99,102,241,0.35)" }}>
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Change Password Modal ───────────────────────────────────────────────────
function ChangePasswordModal({ user, onClose, onSave }) {
  const [currentPw, setCurrentPw] = useState("");
  const [newPw,     setNewPw]     = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [error,     setError]     = useState("");
  const [success,   setSuccess]   = useState(false);
  const [showCur,   setShowCur]   = useState(false);
  const [showNew,   setShowNew]   = useState(false);

  const inputCls   = "w-full px-3 py-2.5 pr-12 rounded-lg text-sm text-white placeholder-slate-600 outline-none transition-all";
  const inputStyle = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" };

  const strength = (() => {
    if (!newPw) return { score: 0, label: "", color: "#64748b" };
    let s = 0;
    if (newPw.length >= 6) s++;
    if (newPw.length >= 10) s++;
    if (/[A-Z]/.test(newPw) && /[a-z]/.test(newPw)) s++;
    if (/[0-9]/.test(newPw)) s++;
    if (/[^A-Za-z0-9]/.test(newPw)) s++;
    if (s <= 1) return { score: 1, label: "Weak",   color: "#ef4444" };
    if (s <= 3) return { score: 2, label: "Medium", color: "#f59e0b" };
    return                  { score: 3, label: "Strong", color: "#22c55e" };
  })();

  const handleSave = () => {
    setError("");
    if (!currentPw) { setError("Enter your current password"); return; }
    if (!checkPassword(currentPw, user.password)) { setError("Current password is incorrect"); return; }
    if (!newPw || newPw.length < 4) { setError("New password must be at least 4 characters"); return; }
    if (newPw !== confirmPw) { setError("New passwords do not match"); return; }
    if (newPw === currentPw) { setError("New password must differ from current"); return; }
    onSave(newPw);
    setSuccess(true);
    setTimeout(() => onClose(), 900);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4" style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}>
      <div className="w-full max-w-sm rounded-2xl overflow-hidden user-menu-anim"
           style={{ background: "#0e1118", border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 32px 80px rgba(0,0,0,0.8)" }}>
        <div className="p-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-base"
                   style={{ background: "rgba(99,102,241,0.15)", color: "#818cf8" }}>🔐</div>
              <div>
                <h3 className="font-bold text-white text-sm">Change Password</h3>
                <p className="text-[10px] text-slate-500 mt-0.5">Update your account password</p>
              </div>
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors text-lg leading-none">✕</button>
          </div>
        </div>

        {success ? (
          <div className="px-5 py-10 text-center">
            <div className="text-4xl mb-3">✅</div>
            <div className="text-sm font-bold text-emerald-400 mb-1">Password Changed</div>
            <div className="text-[10px] text-slate-500">Your password has been updated successfully</div>
          </div>
        ) : (
          <>
            <div className="p-5 space-y-3.5">
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">Current Password</label>
                <div className="relative">
                  <input type={showCur ? "text" : "password"} value={currentPw}
                    onChange={(e) => { setCurrentPw(e.target.value); setError(""); }}
                    placeholder="Enter current password" className={inputCls} style={inputStyle} autoFocus />
                  <button type="button" onClick={() => setShowCur((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 hover:text-slate-300">
                    {showCur ? "Hide" : "Show"}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">New Password</label>
                <div className="relative">
                  <input type={showNew ? "text" : "password"} value={newPw}
                    onChange={(e) => { setNewPw(e.target.value); setError(""); }}
                    placeholder="Min 4 characters" className={inputCls} style={inputStyle} />
                  <button type="button" onClick={() => setShowNew((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 hover:text-slate-300">
                    {showNew ? "Hide" : "Show"}
                  </button>
                </div>
                {newPw && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                      <div className="h-full transition-all duration-300"
                           style={{ width: `${(strength.score / 3) * 100}%`, background: strength.color }} />
                    </div>
                    <span className="text-[10px] font-semibold" style={{ color: strength.color }}>{strength.label}</span>
                  </div>
                )}
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1.5 uppercase tracking-wide">Confirm New Password</label>
                <input type={showNew ? "text" : "password"} value={confirmPw}
                  onChange={(e) => { setConfirmPw(e.target.value); setError(""); }}
                  placeholder="Repeat new password" className="w-full px-3 py-2.5 rounded-lg text-sm text-white placeholder-slate-600 outline-none transition-all" style={inputStyle} />
                {confirmPw && confirmPw !== newPw && (
                  <div className="text-red-400 text-[10px] mt-1">Passwords do not match</div>
                )}
              </div>

              {error && (
                <div className="px-3 py-2 rounded-lg text-[11px] text-red-300"
                     style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)" }}>
                  {error}
                </div>
              )}
            </div>

            <div className="flex gap-2.5 p-5" style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              <button onClick={onClose}
                className="flex-1 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white transition-all"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                Cancel
              </button>
              <button onClick={handleSave}
                disabled={!currentPw || !newPw || !confirmPw}
                className="flex-1 py-2 rounded-xl text-xs font-semibold text-white transition-all"
                style={{
                  background: "linear-gradient(135deg,#3b82f6,#6366f1)",
                  boxShadow: "0 4px 12px rgba(99,102,241,0.35)",
                  opacity: (!currentPw || !newPw || !confirmPw) ? 0.4 : 1,
                }}>
                Update Password
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
