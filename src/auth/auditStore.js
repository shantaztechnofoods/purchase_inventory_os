// Central audit log store — both App.jsx (business actions) and AuthContext (auth events)
// write through here. Persists to localStorage immediately and, when Supabase is enabled,
// also writes to public.audit_log (fire-and-forget — local path is the source of truth
// for the UI; Supabase is the durable multi-user record).

import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

const KEY = "erp_audit";
const listeners = new Set();

// Map our camelCase entry to the snake_case audit_log schema
function toSupabaseRow(full) {
  const isUuid = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  return {
    user_id:   isUuid(full.userId) ? full.userId : null, // public.audit_log.user_id is uuid; older local ids won't match
    user_name: full.user || "System",
    user_role: full.role || null,
    type:      full.type   || "",
    module:    full.module || "",
    action:    full.action || "",
    ref:       full.ref       || null,
    vendor:    full.vendor    || null,
    item_code: full.itemCode  || null,
    item_name: full.itemName  || null,
    serial_no: full.serialNo  || null,
    qty:       (typeof full.qty    === "number" && full.qty)    ? full.qty    : null,
    amount:    (typeof full.amount === "number" && full.amount) ? full.amount : null,
    old_value: full.oldValue ?? null,
    new_value: full.newValue ?? null,
    details:   full.details  ?? null,
  };
}

// Fire-and-forget Supabase write. Never throws; never blocks local flow.
// Verbose logging at every branch — find the exact link where audit insert breaks.
function tryWriteToSupabase(full) {
  if (typeof console !== "undefined") {
    // eslint-disable-next-line no-console
    console.info("[audit→supabase] attempt", { type: full.type, action: full.action, userId: full.userId, isUuid: /^[0-9a-f]{8}-/.test(full.userId || "") });
  }
  if (!isSupabaseEnabled()) {
    if (typeof console !== "undefined") {
      console.warn("[audit→supabase] SKIPPED — isSupabaseEnabled() returned false");
    }
    return;
  }
  const c = getSupabase();
  if (!c) {
    if (typeof console !== "undefined") {
      console.warn("[audit→supabase] SKIPPED — getSupabase() returned null");
    }
    return;
  }
  const row = toSupabaseRow(full);
  if (typeof console !== "undefined") {
    console.info("[audit→supabase] inserting row", row);
  }
  c.from("audit_log").insert(row).then(({ data, error, status, statusText }) => {
    if (error) {
      if (typeof console !== "undefined") {
        console.error("[audit→supabase] INSERT FAILED", {
          message: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
          status, statusText,
        });
      }
    } else {
      if (typeof console !== "undefined") {
        console.info("[audit→supabase] insert OK", { status, data });
      }
    }
  }).catch((err) => {
    if (typeof console !== "undefined") {
      console.error("[audit→supabase] insert threw", err);
    }
  });
}

function fmtDate(d) {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function getAuditLog() {
  try {
    const s = localStorage.getItem(KEY);
    if (s) return JSON.parse(s);
  } catch {}
  return [];
}

function persistAndNotify(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
  listeners.forEach((cb) => { try { cb(list); } catch {} });
}

export function appendAudit(entry) {
  const now = new Date();
  const full = {
    id:        Date.now() + Math.random(),
    ts:        now.toISOString(),
    date:      fmtDate(now),
    user:      "",
    userId:    "",
    role:      "",
    type:      "",
    module:    "",
    action:    "",
    ref:       "",
    vendor:    "",
    itemCode:  "",
    itemName:  "",
    serialNo:  "",
    qty:       0,
    amount:    0,
    oldValue:  null,
    newValue:  null,
    details:   null,
    ...entry,
  };
  const next = [full, ...getAuditLog()];
  persistAndNotify(next);
  tryWriteToSupabase(full);
  return full;
}

// Fetch audit history from Supabase (when enabled). Returns [] on failure.
// Caller can fall back to getAuditLog() if Supabase is unavailable.
export async function fetchAuditFromSupabase({ limit = 1000 } = {}) {
  if (!isSupabaseEnabled()) return null;
  const c = getSupabase();
  if (!c) return null;
  const { data, error } = await c
    .from("audit_log")
    .select("*")
    .order("ts", { ascending: false })
    .limit(limit);
  if (error) {
    if (typeof console !== "undefined") {
      // eslint-disable-next-line no-console
      console.warn("[audit] Supabase read failed:", error.message);
    }
    return null;
  }
  // Map snake_case → camelCase
  return (data || []).map((r) => ({
    id:       r.id,
    ts:       r.ts,
    date:     r.ts ? new Date(r.ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "",
    user:     r.user_name || "System",
    userId:   r.user_id   || "",
    role:     r.user_role || "",
    type:     r.type,
    module:   r.module,
    action:   r.action,
    ref:      r.ref       || "",
    vendor:   r.vendor    || "",
    itemCode: r.item_code || "",
    itemName: r.item_name || "",
    serialNo: r.serial_no || "",
    qty:      r.qty       || 0,
    amount:   r.amount    || 0,
    oldValue: r.old_value,
    newValue: r.new_value,
    details:  r.details,
  }));
}

export function subscribeAudit(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Capture current user context for auth-context-driven audit entries
let _currentUserCtx = null;
export function setAuditUserCtx(user, roleLabel) {
  _currentUserCtx = user ? { id: user.id, fullName: user.fullName, username: user.username, role: roleLabel || user.role } : null;
}
export function getAuditUserCtx() { return _currentUserCtx; }

export function appendAuditWithUser(entry) {
  const ctx = getAuditUserCtx();
  return appendAudit({
    user:   ctx?.fullName || entry.user || "System",
    userId: ctx?.id       || entry.userId || "",
    role:   ctx?.role     || entry.role   || "",
    ...entry,
  });
}
