import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import {
  getUsers, saveUsers, getRoles, saveRoles,
  getSession, saveSession, clearSession,
  checkPassword, hashPassword,
  resolveCanDo, resolveCanView,
  getRoleLabel, getRoleColor, getRoleIcon,
  fetchUserById, fetchAllUsers, fetchAllRoles, touchLastLogin,
} from "./authStore.js";
import { appendAudit, setAuditUserCtx } from "./auditStore.js";
import { setItemHistoryUserCtx } from "../stores/itemsStore.js";
import { setMovementUserCtx } from "../stores/stockMovementsStore.js";
import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";
import { createRole, updateRole, deleteRole } from "../stores/rolesStore.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Mode is fixed at mount — flipping VITE_USE_SUPABASE requires a reload.
  const SUPA = isSupabaseEnabled();
  if (typeof console !== "undefined") {
    // eslint-disable-next-line no-console
    console.info("[auth] AuthProvider mounted, mode =", SUPA ? "SUPABASE" : "LOCAL");
  }

  // Local-mode initial state comes from localStorage; Supabase-mode starts empty and loads async.
  const [session,    setSession]    = useState(() => SUPA ? null : getSession());
  const [users,      setUsersState] = useState(() => SUPA ? [] : getUsers());
  const [roles,      setRolesState] = useState(() => SUPA ? {} : getRoles());
  const [supaUser,   setSupaUser]   = useState(null);            // Supabase-mode current user (already mapped)
  const [isLoading,  setIsLoading]  = useState(SUPA);            // true while initial session is restored

  // currentUser derivation:
  // - Supabase mode → supaUser state (set on login / session restore)
  // - Local mode    → users.find(by session.userId)
  const currentUser = SUPA
    ? supaUser
    : (session ? (users.find((u) => u.id === session.userId) || null) : null);

  // Keep audit-user + item-history user context in sync so writes carry attribution.
  useEffect(() => {
    setAuditUserCtx(currentUser, currentUser ? getRoleLabel(currentUser, roles) : "");
    setItemHistoryUserCtx(currentUser?.id || null, currentUser?.fullName || null);
    setMovementUserCtx(currentUser?.id || null, currentUser?.fullName || null);
  }, [currentUser, roles]);

  // ── Supabase: restore session on mount + listen for changes ────────────────
  useEffect(() => {
    if (!SUPA) return;
    const c = getSupabase();
    if (!c) { setIsLoading(false); return; }

    let unsub = () => {};
    let cancelled = false;

    const loadFromSession = async (sess) => {
      if (!sess?.user) { setSupaUser(null); setIsLoading(false); return; }
      const [u, rolesMap, allUsers] = await Promise.all([
        fetchUserById(sess.user.id),
        fetchAllRoles(),
        fetchAllUsers(),
      ]);
      if (cancelled) return;
      if (rolesMap) setRolesState(rolesMap);
      if (allUsers) setUsersState(allUsers);
      setSupaUser(u);
      setSession({ userId: sess.user.id, loginTime: Date.now() });
      setIsLoading(false);
    };

    c.auth.getSession().then(({ data }) => loadFromSession(data?.session));

    const { data: listener } = c.auth.onAuthStateChange((_event, sess) => {
      loadFromSession(sess);
    });
    unsub = () => { try { listener?.subscription?.unsubscribe(); } catch {} };

    return () => { cancelled = true; unsub(); };
  }, [SUPA]);

  // ── login ──────────────────────────────────────────────────────────────────
  const login = useCallback(async (username, password) => {
    if (typeof console !== "undefined") {
      console.info("[auth] login() called", { username, mode: SUPA ? "SUPABASE" : "LOCAL" });
    }
    if (SUPA) {
      const c = getSupabase();
      if (!c) {
        console.warn("[auth] login: Supabase client null, returning error");
        return { success: false, error: "Supabase client not initialized." };
      }
      // Username-based login. Supabase Auth requires email under the hood, so:
      //   - If the user typed an email (contains '@'), use it as-is (legacy bootstrap admin@erp.shantaz.internal still works)
      //   - Otherwise synthesize the internal email format used by admin-create-user: {username}@users.shantaz.local
      // The synthetic domain is non-routable; users never see it.
      const raw = String(username || "").trim().toLowerCase();
      const email = raw.includes("@") ? raw : `${raw}@users.shantaz.local`;
      console.info("[auth] login: signing in", { input: raw, resolvedEmail: email, passwordLength: password?.length || 0 });
      const { data, error } = await c.auth.signInWithPassword({ email, password });
      console.info("[auth] login: signInWithPassword result", { hasUser: !!data?.user, errorMessage: error?.message, errorStatus: error?.status });
      if (error || !data?.user) {
        appendAudit({
          type: "login_failed", module: "Auth",
          action: `Failed login attempt: ${username}`,
          ref: username, user: username, userId: "",
        });
        return { success: false, error: "Invalid username or password." };
      }
      // Fetch profile
      const profile = await fetchUserById(data.user.id);
      if (!profile) {
        await c.auth.signOut();
        return { success: false, error: "User profile missing in database." };
      }
      if (profile.status === "disabled") {
        await c.auth.signOut();
        return { success: false, error: "Account disabled." };
      }
      // Load roles + all users for the rest of the app
      const [rolesMap, allUsers] = await Promise.all([fetchAllRoles(), fetchAllUsers()]);
      if (rolesMap) setRolesState(rolesMap);
      if (allUsers) setUsersState(allUsers);
      // Update last_login (best-effort)
      touchLastLogin(profile.id);
      setSupaUser(profile);
      setSession({ userId: profile.id, loginTime: Date.now() });
      appendAudit({
        type: "login", module: "Auth",
        action: `User signed in: ${profile.fullName}`,
        ref: profile.username, user: profile.fullName, userId: profile.id,
        role: rolesMap?.[profile.role]?.label || profile.role,
      });
      return { success: true };
    }

    // ── Local (localStorage) path ─ unchanged behaviour ─────────────────────
    const allUsers = getUsers();
    const user = allUsers.find((u) => u.username === username && u.status !== "disabled");
    if (!user) {
      appendAudit({
        type: "login_failed", module: "Auth",
        action: `Failed login attempt for username "${username}"`,
        ref: username, user: username, userId: "",
      });
      return { success: false, error: "Invalid username or password." };
    }
    if (!checkPassword(password, user.password)) {
      appendAudit({
        type: "login_failed", module: "Auth",
        action: `Failed login attempt for "${user.fullName}"`,
        ref: user.username, user: user.fullName, userId: user.id,
      });
      return { success: false, error: "Invalid username or password." };
    }
    const newSession = { userId: user.id, loginTime: Date.now() };
    saveSession(newSession);
    setSession(newSession);
    const updated = allUsers.map((u) =>
      u.id === user.id ? { ...u, lastLogin: new Date().toISOString() } : u
    );
    saveUsers(updated);
    setUsersState(updated);
    appendAudit({
      type: "login", module: "Auth",
      action: `User signed in: ${user.fullName}`,
      ref: user.username, user: user.fullName, userId: user.id,
      role: getRoleLabel(user, getRoles()),
    });
    return { success: true };
  }, [SUPA]);

  // ── logout ─────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    if (currentUser) {
      appendAudit({
        type: "logout", module: "Auth",
        action: `User signed out: ${currentUser.fullName}`,
        ref: currentUser.username, user: currentUser.fullName, userId: currentUser.id,
        role: getRoleLabel(currentUser, roles),
      });
    }
    if (SUPA) {
      const c = getSupabase();
      if (c) await c.auth.signOut();
      setSupaUser(null);
      setSession(null);
    } else {
      clearSession();
      setSession(null);
    }
  }, [currentUser, roles, SUPA]);

  // ── Permissions ────────────────────────────────────────────────────────────
  const canDo = useCallback(
    (module, action) => resolveCanDo(currentUser, roles, module, action),
    [currentUser, roles]
  );
  const canView = useCallback(
    (page) => resolveCanView(currentUser, roles, page),
    [currentUser, roles]
  );

  // ── User / Role mutators (local mode only; Supabase mode needs Edge Functions) ─
  const setUsers = useCallback((updater) => {
    setUsersState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (!SUPA) saveUsers(next);
      return next;
    });
  }, [SUPA]);

  // Legacy bulk setter — kept for backwards compatibility. In Supabase mode this
  // is the diff-based fire-and-forget path (less safe). Prefer the explicit
  // createRoleSupa / updateRoleSupa / deleteRoleSupa methods below.
  const setRoles = useCallback((updater) => {
    setRolesState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      if (!SUPA) saveRoles(next);
      return next;
    });
  }, [SUPA]);

  // Explicit async role mutators — these AWAIT Supabase, only patch local state on success.
  // Used by RoleManagementPage so create/update/delete reliably persist before UI refreshes.
  const createRoleSupa = useCallback(async (key, role) => {
    if (!SUPA) { setRolesState((prev) => ({ ...prev, [key]: role })); saveRoles({ ...roles, [key]: role }); return { success: true }; }
    const res = await createRole(key, role);
    if (!res.success) return res;
    setRolesState((prev) => ({ ...prev, [key]: role }));
    return res;
  }, [SUPA, roles]);

  const updateRoleSupa = useCallback(async (key, role) => {
    if (!SUPA) { setRolesState((prev) => ({ ...prev, [key]: role })); saveRoles({ ...roles, [key]: role }); return { success: true }; }
    const res = await updateRole(key, role);
    if (!res.success) return res;
    setRolesState((prev) => ({ ...prev, [key]: role }));
    return res;
  }, [SUPA, roles]);

  const deleteRoleSupa = useCallback(async (key) => {
    if (!SUPA) {
      setRolesState((prev) => { const next = { ...prev }; delete next[key]; return next; });
      saveRoles(Object.fromEntries(Object.entries(roles).filter(([k]) => k !== key)));
      return { success: true };
    }
    const res = await deleteRole(key);
    if (!res.success) return res;
    setRolesState((prev) => { const next = { ...prev }; delete next[key]; return next; });
    return res;
  }, [SUPA, roles]);

  const resetPassword = useCallback((userId, newPassword) => {
    if (SUPA) {
      if (typeof console !== "undefined") {
        // eslint-disable-next-line no-console
        console.warn("[auth] resetPassword: Supabase mode requires the admin-reset-password Edge Function. Local state updated for UI only.");
      }
    }
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, password: hashPassword(newPassword) } : u)));
  }, [setUsers, SUPA]);

  const roleLabel = currentUser ? getRoleLabel(currentUser, roles) : "";
  const roleColor = currentUser ? getRoleColor(currentUser, roles) : "#6366f1";
  const roleIcon  = currentUser ? getRoleIcon(currentUser, roles)  : "👤";

  return (
    <AuthContext.Provider
      value={{
        currentUser, session, login, logout,
        canDo, canView,
        users, setUsers, roles, setRoles,
        createRoleSupa, updateRoleSupa, deleteRoleSupa,
        resetPassword,
        roleLabel, roleColor, roleIcon,
        isLoading,           // true while Supabase restores the initial session
        supabaseMode: SUPA,  // useful for UI hints
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
