import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

// Simple password obfuscation — local ERP, no backend (used only in localStorage mode)
export const hashPassword = (pw) => btoa(unescape(encodeURIComponent(pw)));
export const checkPassword = (pw, hash) => hashPassword(pw) === hash;

export const DEFAULT_ROLES = {
  Admin: {
    label: "Admin", icon: "👑", color: "#6366f1", badge: "Full Access",
    pages: ["dashboard","inventory","inward","outward","pending","pipeline","machines","vendors","analytics","ai","history","audit","settings","users","roles"],
    actions: {
      inventory: { add: true,  edit: true,  delete: true,  adjust: true  },
      pipeline:  { create: true,  approve: true,  reject: true,  ordered: true,  receive: true,  delete: true  },
      outward:   { bom: true,  manual: true,  editBOM: true  },
      machines:  { updateStage: true  },
      vendors:   { add: true,  edit: true,  delete: true  },
      inward:    { submit: true  },
      pending:   { fulfill: true,  clear: true  },
      users:     { view: true, create: true, edit: true, delete: true },
      roles:     { view: true, create: true, edit: true, delete: true },
    },
  },
  "Purchase Manager": {
    label: "Purchase Manager", icon: "🛒", color: "#3b82f6", badge: "Purchase",
    pages: ["dashboard","inventory","inward","pipeline","vendors","history","analytics"],
    actions: {
      inventory: { add: false, edit: false, delete: false, adjust: false },
      pipeline:  { create: true,  approve: true,  reject: true,  ordered: true,  receive: true,  delete: false },
      outward:   { bom: false, manual: false, editBOM: false },
      machines:  { updateStage: false },
      vendors:   { add: false, edit: false, delete: false },
      inward:    { submit: true  },
      pending:   { fulfill: false, clear: false },
      users:     { view: false, create: false, edit: false, delete: false },
      roles:     { view: false, create: false, edit: false, delete: false },
    },
  },
  "Store Manager": {
    label: "Store Manager", icon: "📦", color: "#22c55e", badge: "Store",
    pages: ["dashboard","inventory","inward","outward","pending","machines","history"],
    actions: {
      inventory: { add: false, edit: false, delete: false, adjust: true  },
      pipeline:  { create: false, approve: false, reject: false, ordered: false, receive: false, delete: false },
      outward:   { bom: true,  manual: true,  editBOM: false },
      machines:  { updateStage: true  },
      vendors:   { add: false, edit: false, delete: false },
      inward:    { submit: true  },
      pending:   { fulfill: true,  clear: true  },
      users:     { view: false, create: false, edit: false, delete: false },
      roles:     { view: false, create: false, edit: false, delete: false },
    },
  },
  Production: {
    label: "Production", icon: "🔧", color: "#f59e0b", badge: "Production",
    pages: ["dashboard","inventory","outward","pending","machines","history"],
    actions: {
      inventory: { add: false, edit: false, delete: false, adjust: false },
      pipeline:  { create: false, approve: false, reject: false, ordered: false, receive: false, delete: false },
      outward:   { bom: true,  manual: false, editBOM: false },
      machines:  { updateStage: true  },
      vendors:   { add: false, edit: false, delete: false },
      inward:    { submit: false },
      pending:   { fulfill: true,  clear: false },
      users:     { view: false, create: false, edit: false, delete: false },
      roles:     { view: false, create: false, edit: false, delete: false },
    },
  },
};

const SUPER_ADMIN_ID = "super_admin_001";

function makeDefaultSuperAdmin() {
  return {
    id: SUPER_ADMIN_ID,
    username: "admin",
    password: hashPassword("admin123"),
    fullName: "Super Admin",
    mobile: "",
    role: "super_admin",
    status: "active",
    lastLogin: null,
  };
}

export function getUsers() {
  try {
    const s = localStorage.getItem("erp_users");
    if (s) {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  const defaults = [makeDefaultSuperAdmin()];
  saveUsers(defaults);
  return defaults;
}

export function saveUsers(users) {
  try { localStorage.setItem("erp_users", JSON.stringify(users)); } catch {}
}

export function getRoles() {
  try {
    const s = localStorage.getItem("erp_roles");
    if (s) {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed === "object") {
        // Migration: ensure Admin role has 'audit' page (added in audit-trail release)
        if (parsed.Admin && Array.isArray(parsed.Admin.pages) && !parsed.Admin.pages.includes("audit")) {
          parsed.Admin = { ...parsed.Admin, pages: [...parsed.Admin.pages, "audit"] };
          saveRoles(parsed);
        }
        return parsed;
      }
    }
  } catch {}
  saveRoles(DEFAULT_ROLES);
  return { ...DEFAULT_ROLES };
}

export function saveRoles(roles) {
  try { localStorage.setItem("erp_roles", JSON.stringify(roles)); } catch {}
}

export function getSession() {
  try {
    const s = localStorage.getItem("erp_session");
    if (s) return JSON.parse(s);
  } catch {}
  return null;
}

export function saveSession(session) {
  try { localStorage.setItem("erp_session", JSON.stringify(session)); } catch {}
}

export function clearSession() {
  try { localStorage.removeItem("erp_session"); } catch {}
}

export function resolveCanDo(user, roles, module, action) {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  const roleConf = roles[user.role];
  if (!roleConf) return false;
  const override = user.overrides?.actions?.[module]?.[action];
  if (override === true) return true;
  if (override === false) return false;
  return roleConf.actions?.[module]?.[action] ?? false;
}

export function resolveCanView(user, roles, page) {
  if (!user) return false;
  if (user.role === "super_admin") return true;
  const roleConf = roles[user.role];
  if (!roleConf) return false;
  const override = user.overrides?.pages?.[page];
  if (override === true) return true;
  if (override === false) return false;
  return (roleConf.pages || []).includes(page);
}

export function getRoleLabel(user, roles) {
  if (!user) return "";
  if (user.role === "super_admin") return "Super Admin";
  return roles[user.role]?.label || user.role;
}

export function getRoleColor(user, roles) {
  if (!user) return "#6366f1";
  if (user.role === "super_admin") return "#ec4899";
  return roles[user.role]?.color || "#6366f1";
}

export function getRoleIcon(user, roles) {
  if (!user) return "👤";
  if (user.role === "super_admin") return "🔑";
  return roles[user.role]?.icon || "👤";
}

// ─── Supabase mappers + fetchers ────────────────────────────────────────────
// Convert public.users row → client user shape used everywhere in the app.
export function mapSupabaseUser(row) {
  if (!row) return null;
  return {
    id:        row.id,
    username:  row.username,
    fullName:  row.full_name,
    mobile:    row.mobile || "",
    role:      row.role_key,
    status:    row.status,
    overrides: row.overrides || null,
    lastLogin: row.last_login || null,
  };
}

// Convert public.roles rows → client roles map keyed by role key
export function mapSupabaseRoles(rows) {
  const out = {};
  (rows || []).forEach((r) => {
    out[r.key] = {
      label:   r.label,
      icon:    r.icon,
      color:   r.color,
      badge:   r.badge,
      pages:   r.pages   || [],
      actions: r.actions || {},
    };
  });
  return out;
}

// Fetch a single user by id (UUID). Returns null on failure.
export async function fetchUserById(id) {
  if (!isSupabaseEnabled()) return null;
  const c = getSupabase();
  if (!c || !id) return null;
  const { data, error } = await c.from("users").select("*").eq("id", id).maybeSingle();
  if (error) {
    if (typeof console !== "undefined") console.warn("[auth] fetchUserById failed:", error.message);
    return null;
  }
  return mapSupabaseUser(data);
}

// Fetch all users (for User Management page when Supabase is enabled).
export async function fetchAllUsers() {
  if (!isSupabaseEnabled()) return null;
  const c = getSupabase();
  if (!c) return null;
  const { data, error } = await c.from("users").select("*").order("created_at", { ascending: true });
  if (error) {
    if (typeof console !== "undefined") console.warn("[auth] fetchAllUsers failed:", error.message);
    return null;
  }
  return (data || []).map(mapSupabaseUser);
}

// Fetch all roles (for permission resolution + Role Management page).
export async function fetchAllRoles() {
  if (!isSupabaseEnabled()) return null;
  const c = getSupabase();
  if (!c) return null;
  const { data, error } = await c.from("roles").select("*").order("key", { ascending: true });
  if (error) {
    if (typeof console !== "undefined") console.warn("[auth] fetchAllRoles failed:", error.message);
    return null;
  }
  return mapSupabaseRoles(data);
}

// Touch users.last_login for the given user id (best-effort).
export async function touchLastLogin(id) {
  if (!isSupabaseEnabled() || !id) return;
  const c = getSupabase();
  if (!c) return;
  await c.from("users").update({ last_login: new Date().toISOString() }).eq("id", id);
}
