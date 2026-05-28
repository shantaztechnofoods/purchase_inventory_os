// Stock Movements store — wraps the atomic record_stock_movement RPC + reads the ledger.
import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

export const MOVEMENT_TYPES = [
  "purchase_in", "production_issue", "production_output",
  "manual_adjustment", "sales_out", "return_in", "return_out",
];

export const MOVEMENT_META = {
  purchase_in:       { label: "Purchase In",       sign: "+", color: "#22c55e" },
  production_output: { label: "Production Output",  sign: "+", color: "#10b981" },
  return_in:         { label: "Return In",          sign: "+", color: "#14b8a6" },
  production_issue:  { label: "Production Issue",    sign: "−", color: "#f59e0b" },
  sales_out:         { label: "Sales Out",          sign: "−", color: "#ef4444" },
  return_out:        { label: "Return Out",         sign: "−", color: "#fb923c" },
  manual_adjustment: { label: "Manual Adjustment",  sign: "±", color: "#8b5cf6" },
};

// Capture current user for movement attribution (set from AuthContext)
let _userCtx = null;
export function setMovementUserCtx(userId, userName) {
  _userCtx = userId ? { id: userId, name: userName || "Unknown" } : null;
}

// Map a legacy free-text eventType + delta → a canonical movement_type.
export function inferMovementType(eventType, delta) {
  const e = String(eventType || "").toLowerCase();
  if (e.includes("correction") || e.includes("adjust"))      return "manual_adjustment";
  if (e.includes("reversed") || e.includes("reverse"))       return "manual_adjustment";
  if (e.includes("bom"))                                     return "production_issue";
  if (e.includes("fulfill"))                                 return "production_issue";
  if (e.includes("manual out") || e.includes("outward"))     return "production_issue";
  if (e.includes("po") || e.includes("inward") || e.includes("restock") || e.includes("receive")) return "purchase_in";
  return Number(delta) >= 0 ? "purchase_in" : "production_issue";
}

function fromRow(r) {
  return {
    id:            r.id,
    itemId:        r.item_id,
    itemCode:      r.item_code,
    itemName:      r.item_name || "",
    movementType:  r.movement_type,
    qty:           Number(r.qty) || 0,
    beforeStock:   Number(r.before_stock) || 0,
    afterStock:    Number(r.after_stock) || 0,
    referenceType: r.reference_type || "",
    referenceId:   r.reference_id || "",
    notes:         r.notes || "",
    createdBy:     r.created_by || "",
    createdByName: r.created_by_name || "",
    createdAt:     r.created_at,
  };
}

// Record a movement via the atomic RPC. p_qty is the SIGNED delta.
// Returns { success, before_stock, after_stock, status, available_stock } or { success:false, error }.
export async function recordMovement(itemCode, movementType, signedQty, opts = {}) {
  console.info("[stock_movement] record", { itemCode, movementType, signedQty, ref: opts.referenceId });
  if (!isSupabaseEnabled()) return { success: true, localOnly: true };
  const c = getSupabase();
  if (!c) return { success: false, error: "Supabase not configured" };
  const { data, error } = await c.rpc("record_stock_movement", {
    p_item_code:      itemCode,
    p_movement_type:  movementType,
    p_qty:            signedQty,
    p_reference_type: opts.referenceType || null,
    p_reference_id:   opts.referenceId   || null,
    p_notes:          opts.notes         || null,
    p_user_id:        _userCtx?.id        || null,
    p_user_name:      _userCtx?.name      || null,
  });
  if (error) {
    console.error("[stock_movement] RPC failed", { code: error.code, message: error.message, details: error.details, hint: error.hint });
    return { success: false, error: error.message };
  }
  console.info("[stock_movement] RPC ok", data);
  return { success: true, ...(data || {}) };
}

// Fetch movement history for one item (most recent first).
export async function fetchMovements(itemCode, { limit = 100 } = {}) {
  if (!isSupabaseEnabled()) return [];
  const c = getSupabase();
  if (!c) return [];
  const { data, error } = await c.from("stock_movements")
    .select("*").eq("item_code", itemCode)
    .order("created_at", { ascending: false }).limit(limit);
  if (error) { console.error("[stock_movement] fetch failed", error); return []; }
  return (data || []).map(fromRow);
}

// Fetch the most recent movements across all items (for a global ledger view).
export async function fetchRecentMovements({ limit = 200 } = {}) {
  if (!isSupabaseEnabled()) return [];
  const c = getSupabase();
  if (!c) return [];
  const { data, error } = await c.from("stock_movements")
    .select("*").order("created_at", { ascending: false }).limit(limit);
  if (error) { console.error("[stock_movement] recent fetch failed", error); return []; }
  return (data || []).map(fromRow);
}
