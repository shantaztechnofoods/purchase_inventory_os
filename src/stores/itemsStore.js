// Items + Item History store
// Source of truth: public.items + public.item_history
// Falls back to localStorage when Supabase is disabled.

import { isSupabaseEnabled, IS_PROD } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";
import { recordMovement, inferMovementType } from "./stockMovementsStore.js";

const LOCAL_KEY = "erp_items";

// ─── helpers shared by both paths ──────────────────────────────────────────
function recomputeStatus(stock, min) {
  if (stock <= 0) return "critical";
  if (stock <= min && stock / Math.max(1, min) < 0.15) return "critical";
  if (stock <= min) return "warning";
  return "safe";
}

function fmtDate(d) {
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// ─── snake_case ↔ camelCase mappers ────────────────────────────────────────
function toRow(item, category) {
  return {
    code:               item.code,
    name:               item.name,
    category:           category || item.category,
    unit:               item.unit       || null,
    stock:              Number(item.stock) || 0,
    min_stock:          Number(item.min)   || 0,
    max_stock:          item.max != null   ? Number(item.max) : null,
    status:             item.status        || recomputeStatus(item.stock, item.min),
    location:           item.location           || null,
    last_purchase_rate: item.lastPurchaseRate   || null,
    vendor_links:       item.vendorLinks   || [],
    trend:              item.trend         || [0, 0, 0, 0, item.stock || 0],
  };
}

function fromRow(r) {
  const stock    = Number(r.stock) || 0;
  const reserved = Number(r.reserved_stock) || 0;
  return {
    id:               r.id,
    code:             r.code,
    name:             r.name,
    category:         r.category,
    unit:             r.unit || "",
    stock,                                          // current_stock (physical on-hand)
    reservedStock:    reserved,
    availableStock:   r.available_stock != null ? Number(r.available_stock) : (stock - reserved),
    reorderLevel:     Number(r.reorder_level) || 0,
    min:              Number(r.min_stock) || 0,
    max:              r.max_stock != null ? Number(r.max_stock) : 0,
    status:           r.status || recomputeStatus(stock, r.min_stock),
    location:         r.location || "",
    lastPurchaseRate: r.last_purchase_rate || 0,
    vendor:           "",                          // derived at render time from vendorLinks
    vendorLinks:      r.vendor_links || [],
    trend:            Array.isArray(r.trend) ? r.trend : [0, 0, 0, 0, stock],
    history:          [],                          // hydrated on demand from item_history
  };
}

function historyFromRow(r) {
  return {
    date:  r.event_date ? new Date(r.event_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "",
    event: r.event,
    change: Number(r.change) || 0,
    qty:   Number(r.qty_after) || 0,
  };
}

// ─── localStorage helpers (fallback path) ──────────────────────────────────
function getLocal() {
  try { const s = localStorage.getItem(LOCAL_KEY); if (s) {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } } catch {}
  return {};
}
function setLocal(grouped) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(grouped)); } catch {}
}

// ─── PUBLIC API ────────────────────────────────────────────────────────────

// Fetch all items grouped by category — returns same shape as today's `items` state.
export async function fetchItems() {
  const mode = isSupabaseEnabled() ? "SUPABASE" : "LOCAL";
  console.info("[items:load] start", { mode });
  if (!isSupabaseEnabled()) {
    const g = getLocal();
    const total = Object.values(g).reduce((s, l) => s + (l?.length || 0), 0);
    console.info("[items:load] local ok", { categories: Object.keys(g).length, items: total });
    return g;
  }
  const c = getSupabase();
  if (!c) { console.warn("[items:load] client null, local fallback"); return getLocal(); }
  // Try filtered (is_active = true) first; on column-not-found, retry without filter
  let { data, error } = await c.from("items").select("*").eq("is_active", true).order("code", { ascending: true });
  if (error && (error.code === "42703" || /column .*is_active.* does not exist/i.test(error.message || ""))) {
    console.warn("[items:load] is_active column missing (migration 008 not run) — falling back to unfiltered fetch");
    const retry = await c.from("items").select("*").order("code", { ascending: true });
    data = retry.data; error = retry.error;
  }
  if (error) { console.error("[items:load] supabase error", error); return getLocal(); }
  const grouped = {};
  for (const row of (data || [])) {
    const item = fromRow(row);
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }
  setLocal(grouped); // cache
  const total = (data || []).length;
  console.info("[items:load] supabase ok", { categories: Object.keys(grouped).length, items: total });
  return grouped;
}

// Create a new item. Inserts initial "Opening" history row.
// Paranoid logging — every step logs unconditionally with markers so we can prove
// reachability when debugging a missing history write.
export async function createItem(category, item) {
  const traceId = Math.random().toString(36).slice(2, 8);
  console.log(`%c[items:create:${traceId}] ENTERED`, "color:#3b82f6;font-weight:bold");
  console.log(`[${traceId}] step 1 — payload received:`, { code: item.code, name: item.name, category, stock: item.stock });

  try {
    if (!isSupabaseEnabled()) {
      console.log(`[${traceId}] step 2 — Supabase OFF, local path`);
      const enriched = {
        ...item, category,
        history: [{ date: fmtDate(new Date()), event: "Opening", change: 0, qty: item.stock || 0 }],
      };
      const g = getLocal();
      if (!g[category]) g[category] = [];
      g[category].push(enriched);
      setLocal(g);
      console.log(`[${traceId}] step 3 — local saved`);
      return { success: true, item: enriched };
    }

    console.log(`[${traceId}] step 2 — Supabase ON`);
    const c = getSupabase();
    if (!c) { console.error(`[${traceId}] step 2.5 — NO CLIENT, abort`); return { success: false, error: "Supabase not configured" }; }
    console.log(`[${traceId}] step 3 — client OK`);

    const row = toRow(item, category);
    console.log(`[${traceId}] step 4 — items.insert payload:`, row);

    let insertData, insertError;
    try {
      const resp = await c.from("items").insert(row).select().single();
      insertData = resp.data; insertError = resp.error;
      console.log(`[${traceId}] step 5 — items.insert response:`, { data: insertData, error: insertError, status: resp.status, statusText: resp.statusText });
    } catch (thrown) {
      console.error(`[${traceId}] step 5 — items.insert THREW:`, thrown);
      return { success: false, error: `items.insert threw: ${thrown?.message || thrown}` };
    }

    if (insertError) {
      console.error(`[${traceId}] step 6 — items.insert FAILED, aborting before addItemHistory:`, insertError);
      return { success: false, error: insertError.message };
    }
    if (!insertData) {
      console.error(`[${traceId}] step 6 — items.insert returned no data (data is null/undefined)`);
      return { success: false, error: "items.insert returned no row" };
    }
    if (!insertData.id) {
      console.error(`[${traceId}] step 6 — items.insert returned row WITHOUT id:`, insertData);
      // Continue anyway — addItemHistory accepts null item_id (in new schema; legacy will fail)
    }

    console.log(`%c[${traceId}] step 7 — items.insert OK, item.id =`, "color:#22c55e", insertData.id);
    const newItem = fromRow(insertData);
    console.log(`[${traceId}] step 8 — mapped newItem:`, newItem);

    const historyPayload = {
      item_code:       newItem.code,
      item_name:       newItem.name,
      category:        newItem.category,
      event_type:      "Opening",
      quantity_change: 0,
      stock_before:    0,
      stock_after:     newItem.stock,
      notes:           "Item created",
    };
    console.log(`%c[${traceId}] step 9 — ABOUT TO CALL addItemHistory(${newItem.id}, payload):`, "color:#f59e0b;font-weight:bold", historyPayload);

    let histRes;
    try {
      histRes = await addItemHistory(newItem.id, historyPayload);
      console.log(`%c[${traceId}] step 10 — addItemHistory RETURNED:`, "color:#22c55e;font-weight:bold", histRes);
    } catch (thrown) {
      console.error(`%c[${traceId}] step 10 — addItemHistory THREW:`, "color:#ef4444;font-weight:bold", thrown);
      histRes = { success: false, error: `addItemHistory threw: ${thrown?.message || thrown}`, threw: true };
    }

    newItem.history = [{ date: fmtDate(new Date()), event: "Opening", change: 0, qty: newItem.stock }];
    console.log(`%c[items:create:${traceId}] DONE`, "color:#3b82f6;font-weight:bold", { itemId: newItem.id, historyOk: histRes?.success, schema: histRes?.schema });
    return { success: true, item: newItem };
  } catch (outerErr) {
    console.error(`%c[items:create:${traceId}] OUTER EXCEPTION — function aborted before completion`, "color:#ef4444;font-weight:bold", outerErr);
    return { success: false, error: `createItem threw: ${outerErr?.message || outerErr}` };
  }
}

// Update an item by original code (handles code/category changes).
export async function updateItem(originalCode, originalCategory, updatedItem, newCategory) {
  console.info("[items:update] start", { originalCode, newCode: updatedItem.code, newCategory });
  if (!isSupabaseEnabled()) {
    const g = getLocal();
    // Remove from original category
    if (g[originalCategory]) g[originalCategory] = g[originalCategory].filter((i) => i.code !== originalCode);
    // Insert into new category, preserving history
    const targetCat = newCategory || originalCategory;
    if (!g[targetCat]) g[targetCat] = [];
    const existing = (g[originalCategory] || []).find((i) => i.code === originalCode);
    g[targetCat].push({ ...updatedItem, history: updatedItem.history || existing?.history || [] });
    setLocal(g);
    console.info("[items:update] local ok");
    return { success: true, item: updatedItem };
  }
  const c = getSupabase();
  if (!c) return { success: false, error: "Supabase not configured" };
  // METADATA-ONLY update. stock / status / trend / reserved_stock / available_stock are
  // engine-managed — they may ONLY change via record_stock_movement. Editing an item never
  // mutates physical stock; a stock correction goes through handleInventoryCorrection → RPC.
  const row = {
    code:               updatedItem.code,
    name:               updatedItem.name,
    category:           (newCategory || originalCategory) || updatedItem.category,
    unit:               updatedItem.unit         || null,
    min_stock:          Number(updatedItem.min)  || 0,
    max_stock:          updatedItem.max != null  ? Number(updatedItem.max) : null,
    location:           updatedItem.location          || null,
    last_purchase_rate: updatedItem.lastPurchaseRate  || null,
    vendor_links:       updatedItem.vendorLinks  || [],
  };
  const { data, error } = await c.from("items").update(row).eq("code", originalCode).select().single();
  if (error) { console.error("[items:update] supabase failed", error); return { success: false, error: error.message }; }
  const updated = fromRow(data);
  console.info("[items:update] supabase ok", { id: updated.id });
  return { success: true, item: updated };
}

// Delete an item by code. Cascades to item_history via FK ON DELETE CASCADE.
export async function deleteItem(category, code) {
  console.info("[items:delete] start", { code, category });
  if (!isSupabaseEnabled()) {
    const g = getLocal();
    if (g[category]) g[category] = g[category].filter((i) => i.code !== code);
    setLocal(g);
    console.info("[items:delete] local ok");
    return { success: true };
  }
  const c = getSupabase();
  if (!c) return { success: false, error: "Supabase not configured" };
  // Fetch item details for audit history before deactivation
  const { data: cur } = await c.from("items").select("id, code, name, category, stock").eq("code", code).maybeSingle();
  // Soft delete: UPDATE is_active=false instead of DELETE — preserves item_history rows
  const { error } = await c.from("items").update({
    is_active:      false,
    deactivated_at: new Date().toISOString(),
    deactivated_by: _currentUserCtx?.id || null,
  }).eq("code", code);
  if (error) { console.error("[items:delete] supabase soft-delete failed", error); return { success: false, error: error.message }; }
  // Write a final history row noting deactivation
  if (cur) {
    await addItemHistory(cur.id, {
      item_code: cur.code, item_name: cur.name, category: cur.category,
      event_type: "Deactivated", quantity_change: 0,
      stock_before: Number(cur.stock) || 0, stock_after: Number(cur.stock) || 0,
      notes: "Item deactivated (soft delete)",
    });
  }
  console.info("[items:delete] supabase soft-delete ok");
  return { success: true };
}

// Capture current user context for history denormalization
let _currentUserCtx = null;
export function setItemHistoryUserCtx(userId, userName) {
  _currentUserCtx = userId ? { id: userId, name: userName || "Unknown" } : null;
}

// Update stock atomically via the record_stock_movement RPC (the canonical engine).
// The RPC locks the row, blocks negative stock, updates items, and inserts BOTH
// stock_movements AND item_history in one transaction.
// `delta` is the SIGNED change. `eventType` is a legacy free-text label that we map
// to a canonical movement_type. Returns { success, newStock, newStatus, historyEntry }.
export async function updateStockAndHistory(category, code, delta, eventType, opts = {}) {
  console.info("[items:stock] start", { code, delta, eventType, ref: opts.referenceNumber });
  if (!isSupabaseEnabled()) {
    return { success: true, localOnly: true };
  }
  const movementType = opts.movementType || inferMovementType(eventType, delta);
  const res = await recordMovement(code, movementType, Number(delta), {
    referenceType: opts.referenceType || (eventType ? String(eventType).split(":")[0].trim() : null),
    referenceId:   opts.referenceNumber || opts.referenceId || null,
    notes:         opts.notes || eventType || null,
  });
  if (!res.success) {
    console.error("[items:stock] RPC failed", res.error);
    return { success: false, error: res.error };
  }
  return {
    success:   true,
    newStock:  res.after_stock,
    newStatus: res.status,
    available: res.available_stock,
    historyEntry: { date: fmtDate(new Date()), event: eventType || movementType, change: Number(delta), qty: res.after_stock },
  };
}

// Insert a single item_history row. Use for any stock-affecting action.
// Schema-tolerant: tries new 008-schema first, falls back to legacy 002-schema on ANY
// shape-related error. Fully verbose — every step is logged so you can copy-paste
// console output to debug write failures.
export async function addItemHistory(itemId, payload) {
  // Unconditional marker — proves entry regardless of console group expansion
  console.log("%c⚡ addItemHistory CALLED", "color:#a855f7;font-weight:bold", { itemId, eventType: payload?.event_type || payload?.event, callerStack: new Error().stack?.split("\n").slice(1, 4).join(" ← ") });
  console.group("[item_history:create] ENTERED");
  const eventType = payload.event_type || payload.event || "Event";
  const qtyChange = payload.quantity_change != null ? payload.quantity_change : (payload.change != null ? payload.change : 0);
  const stockAfter = payload.stock_after != null ? payload.stock_after : (payload.qty_after != null ? payload.qty_after : 0);
  console.info("payload received:", { itemId, eventType, qtyChange, stockAfter, full: payload });
  console.info("user ctx:", _currentUserCtx);
  if (!isSupabaseEnabled()) { console.info("Supabase mode OFF — no-op"); console.groupEnd(); return { success: true }; }
  const c = getSupabase();
  if (!c) { console.error("[item_history:error] no client"); console.groupEnd(); return { success: false, error: "Supabase not configured" }; }

  // ── Attempt 1: NEW schema (migration 008) ──────────────────────────────────
  const newRow = {
    item_id:          itemId || null,
    item_code:        payload.item_code || null,
    item_name:        payload.item_name || null,
    category:         payload.category || null,
    event_type:       eventType,
    quantity_change:  qtyChange,
    stock_before:     payload.stock_before != null ? payload.stock_before : null,
    stock_after:      stockAfter,
    reference_number: payload.reference_number || null,
    notes:            payload.notes || null,
    created_by:       _currentUserCtx?.id || null,
    created_by_name:  _currentUserCtx?.name || null,
  };
  console.info("ATTEMPT 1 — NEW schema insert payload:", newRow);
  const resp1 = await c.from("item_history").insert(newRow);
  console.info("ATTEMPT 1 — Supabase response:", { error: resp1.error, status: resp1.status, statusText: resp1.statusText, data: resp1.data });
  if (!resp1.error) {
    console.info("✅ item_history insert OK (new schema)");
    console.groupEnd();
    return { success: true, schema: "new" };
  }

  // ── Attempt 2: fall back to LEGACY schema (migration 002 only — 008 not run) ─
  // Trigger on ANY shape-related error: undefined-column, not-null-violation, OR
  // generic-error-message-mentioning-column. Also retry on PGRST204 (column not found in schema cache).
  const e = resp1.error;
  const looksLikeShapeError =
    e.code === "42703" ||
    e.code === "23502" ||
    e.code === "PGRST204" ||
    /column .* does not exist|could not find the .* column|null value in column .* violates not-null|schema cache/i.test(e.message || "") ||
    /column .* does not exist|null value in column/i.test(e.details || "") ||
    /column .* does not exist|null value in column/i.test(e.hint || "");
  console.warn("ATTEMPT 1 FAILED — error analysis:", {
    code: e.code, message: e.message, details: e.details, hint: e.hint,
    willRetryLegacy: looksLikeShapeError,
  });

  if (looksLikeShapeError) {
    console.warn("→ Retrying with LEGACY schema (run migration 008 to upgrade)");
    const legacyRow = {
      item_id:    itemId || null,
      item_code:  payload.item_code || null,
      event_date: payload.event_date || new Date().toISOString().slice(0, 10),
      event:      eventType,
      change:     qtyChange,
      qty_after:  stockAfter,
    };
    console.info("ATTEMPT 2 — LEGACY schema insert payload:", legacyRow);
    const resp2 = await c.from("item_history").insert(legacyRow);
    console.info("ATTEMPT 2 — Supabase response:", { error: resp2.error, status: resp2.status, statusText: resp2.statusText, data: resp2.data });
    if (!resp2.error) {
      console.info("✅ item_history insert OK (legacy schema)");
      console.groupEnd();
      return { success: true, schema: "legacy" };
    }
    console.error("❌ BOTH ATTEMPTS FAILED — legacy retry error:", { code: resp2.error.code, message: resp2.error.message, details: resp2.error.details, hint: resp2.error.hint });
    console.groupEnd();
    return { success: false, error: resp2.error.message, attempt1Error: e, attempt2Error: resp2.error };
  }

  console.error("❌ Non-shape error — no retry. Error:", e);
  console.groupEnd();
  return { success: false, error: e.message, errorObject: e };
}

// ─── Console diagnostic probe ──────────────────────────────────────────────
// Run from browser console: await window.__debugItemHistory()
// Tests the full chain: env check, client init, items SELECT, item_history INSERT,
// item_history SELECT. Pinpoints exact failure step.
export async function debugItemHistory() {
  console.group("🔍 __debugItemHistory");
  console.info("1. Env check:", { isSupabaseEnabled: isSupabaseEnabled() });
  if (!isSupabaseEnabled()) { console.error("Supabase disabled — set VITE_USE_SUPABASE=true"); console.groupEnd(); return { ok: false, step: "env" }; }
  const c = getSupabase();
  console.info("2. Client:", c ? "OK" : "NULL");
  if (!c) { console.groupEnd(); return { ok: false, step: "client" }; }

  console.info("3. Auth check:");
  const { data: authUser } = await c.auth.getUser();
  console.info("   auth.uid():", authUser?.user?.id);

  console.info("4. is_active_user() check (via probe profile fetch):");
  const { data: prof, error: profErr } = await c.from("users").select("id, status, role_key, full_name").eq("id", authUser?.user?.id).maybeSingle();
  console.info("   profile:", { prof, profErr });
  if (!prof || prof.status !== "active") console.error("   ⚠️ No active profile row → RLS will reject writes");

  console.info("5. Sample item from items table:");
  const { data: oneItem, error: itemErr } = await c.from("items").select("id, code, name, category, stock").limit(1).maybeSingle();
  console.info("   sample:", { oneItem, itemErr });
  if (!oneItem) { console.error("   No items found — create one first"); console.groupEnd(); return { ok: false, step: "no-items" }; }

  console.info("6. Probe item_history INSERT:");
  const result = await addItemHistory(oneItem.id, {
    item_code: oneItem.code,
    item_name: oneItem.name,
    category:  oneItem.category,
    event_type: "DebugProbe",
    quantity_change: 0,
    stock_before: oneItem.stock,
    stock_after:  oneItem.stock,
    notes: `Probe at ${new Date().toISOString()}`,
  });
  console.info("   addItemHistory result:", result);

  console.info("7. SELECT item_history to verify visibility:");
  const { data: histRows, error: histErr } = await c.from("item_history").select("*").order("created_at", { ascending: false }).limit(5);
  console.info("   latest 5 rows:", { count: histRows?.length, rows: histRows, error: histErr });

  console.groupEnd();
  return { ok: result.success, result, sampleItem: oneItem, latestRows: histRows };
}

if (typeof window !== "undefined" && !IS_PROD) {  // debug probe — dev/staging only
  window.__debugItemHistory = debugItemHistory;
}

// Fetch history rows for an item (for the detail drawer / audit drill-down).
export async function fetchItemHistory(itemId, { limit = 200 } = {}) {
  console.info("[item_history:fetch] start", { itemId });
  if (!isSupabaseEnabled() || !itemId) return [];
  const c = getSupabase();
  if (!c) return [];
  const { data, error } = await c.from("item_history")
    .select("*")
    .eq("item_id", itemId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) { console.error("[item_history:error] fetch failed", error); return []; }
  console.info("[item_history:fetch] supabase ok", { count: (data || []).length });
  return (data || []).map(historyFromRow);
}

// ─── One-time migration utility ──────────────────────────────────────────────
// Reads all items from localStorage and inserts into Supabase. Idempotent on code
// (UNIQUE constraint will reject duplicates). Inserts an "Opening" history row
// for each successfully-inserted item.
//
// Call from browser console: window.__migrateLocalItemsToSupabase()
export async function migrateLocalItemsToSupabase() {
  console.info("[items:migrate] start");
  if (!isSupabaseEnabled()) { console.warn("[items:migrate] Supabase mode is off — nothing to do"); return; }
  const c = getSupabase();
  if (!c) { console.error("[items:migrate] no client"); return; }
  const grouped = getLocal();
  const results = { inserted: 0, skipped: 0, failed: 0, errors: [] };
  for (const [cat, list] of Object.entries(grouped)) {
    for (const item of (list || [])) {
      try {
        const row = toRow(item, cat);
        const { data, error } = await c.from("items").insert(row).select().single();
        if (error) {
          if (error.code === "23505") { results.skipped++; }   // unique violation (already exists)
          else { results.failed++; results.errors.push({ code: item.code, error: error.message }); }
        } else {
          results.inserted++;
          await addItemHistory(data.id, {
            item_code: data.code, item_name: data.name, category: data.category,
            event_type: "Opening", quantity_change: 0,
            stock_before: 0, stock_after: data.stock,
            notes: "Initial migration from localStorage",
          });
        }
      } catch (err) {
        results.failed++;
        results.errors.push({ code: item.code, error: err.message });
      }
    }
  }
  console.info("[items:migrate] done", results);
  return results;
}

if (typeof window !== "undefined" && !IS_PROD) {  // debug helpers — dev/staging only
  window.__migrateLocalItemsToSupabase = migrateLocalItemsToSupabase;
}
