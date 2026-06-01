// Purchase Orders store — public.purchase_orders
import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

const LOCAL_KEY = "erp_pos";

function toRow(p) {
  return {
    id:            p.id,
    vendor:        p.vendor,
    vendor_id:     p.vendorId || null,
    status:        p.status,
    date:          p.date ? toIsoDate(p.date) : null,
    ordered_date:  p.orderedDate  ? toIsoDate(p.orderedDate)  : null,
    received_date: p.receivedDate ? toIsoDate(p.receivedDate) : null,
    eta:           p.eta || null,
    priority:      p.priority || "normal",
    amount:        p.amount || null,
    gst:           p.gst    || null,
    notes:         p.notes  || null,
    reject_reason: p.rejectReason || null,
    line_items:    p.lineItems   || [],
    activity_log:  p.activityLog || [],
  };
}
function fromRow(r) {
  return {
    id:            r.id,
    vendor:        r.vendor,
    vendorId:      r.vendor_id || null,
    status:        r.status,
    date:          r.date || "",
    orderedDate:   r.ordered_date  || null,
    receivedDate:  r.received_date || null,
    eta:           r.eta      || "",
    priority:      r.priority || "normal",
    amount:        Number(r.amount) || 0,
    gst:           Number(r.gst)    || 0,
    cgst:          Number(r.cgst)   || 0,    // migration 018 — split tax for local
    sgst:          Number(r.sgst)   || 0,    // migration 018
    igst:          Number(r.igst)   || 0,    // migration 018 — interstate
    notes:         r.notes        || "",
    rejectReason:  r.reject_reason || "",
    lineItems:     Array.isArray(r.line_items)   ? r.line_items   : [],
    activityLog:   Array.isArray(r.activity_log) ? r.activity_log : [],
    companyId:     r.company_id || null,     // PO Settings company profile (migration 015)
    template:      r.template   || null,     // PO template preset (migration 015)
    purchaseType:  r.purchase_type || null,  // migration 018 — operator-chosen GST class
    gstType:       r.gst_type      || null,  // migration 018 — local | interstate | …
    poDate:        r.po_date       || r.date || "",  // migration 018 — explicit PO Date
  };
}

// Detect schema-cache / column-missing errors so we can retry without the newest
// optional columns when the migration hasn't been applied in production yet.
// Same pattern as itemsStore.isMissingColumnError — kept local so the import
// graph stays flat (this file already has zero deps besides supabase/env).
function isMissingColumnError(err) {
  if (!err) return false;
  if (err.code === "42703" || err.code === "PGRST204") return true;
  return /column .* does not exist|schema cache|could not find the .* column/i.test(err.message || err.details || err.hint || "");
}
function toIsoDate(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s); if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function getLocal() { try { const s = localStorage.getItem(LOCAL_KEY); if (s) return JSON.parse(s); } catch {} return []; }
function setLocal(a) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(a)); } catch {} }

export async function fetchPOs() {
  const mode = isSupabaseEnabled() ? "SUPABASE" : "LOCAL";
  console.info("[pos:load] start", { mode });
  if (!isSupabaseEnabled()) { const a = getLocal(); console.info("[pos:load] local ok", { count: a.length }); return a; }
  const c = getSupabase();
  if (!c) return getLocal();
  const { data, error } = await c.from("purchase_orders").select("*").order("created_at", { ascending: false });
  if (error) { console.error("[pos:load] failed", error); return getLocal(); }
  const out = (data || []).map(fromRow);
  setLocal(out);
  console.info("[pos:load] supabase ok", { count: out.length });
  return out;
}

export async function createPO(po) {
  console.info("[pos:create] start", { id: po.id, purchaseType: po.purchaseType });
  if (!isSupabaseEnabled()) { setLocal([po, ...getLocal()]); return { success: true, po }; }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const baseRow = toRow(po);
  // 015 columns
  const with015 = { ...baseRow, company_id: po.companyId || null, template: po.template || null };
  // 018 columns — purchase type, GST split, explicit PO date
  const fullRow = {
    ...with015,
    purchase_type: po.purchaseType || null,
    gst_type:      po.gstType      || null,
    po_date:       po.poDate ? toIsoDate(po.poDate) : (po.date ? toIsoDate(po.date) : null),
    cgst:          po.cgst || null,
    sgst:          po.sgst || null,
    igst:          po.igst || null,
  };
  let { data, error } = await c.from("purchase_orders").insert(fullRow).select().single();

  // Three-tier retry mirrors the way migrations have rolled out:
  //   018 missing → drop purchase_type / gst_type / po_date / cgst / sgst / igst
  //   015 missing → drop company_id / template too
  if (error && isMissingColumnError(error)) {
    console.warn("[pos:create] migration 018 columns missing — retrying without purchase_type/gst_type/po_date/cgst/sgst/igst");
    ({ data, error } = await c.from("purchase_orders").insert(with015).select().single());
  }
  if (error && isMissingColumnError(error)) {
    console.warn("[pos:create] migration 015 columns missing — retrying without company_id/template");
    ({ data, error } = await c.from("purchase_orders").insert(baseRow).select().single());
  }
  if (error) { console.error("[pos:create] failed", error); return { success: false, error: error.message }; }
  const out = fromRow(data);
  console.info("[pos:create] ok");
  return { success: true, po: out };
}

export async function updatePO(id, updates) {
  console.info("[pos:update] start", { id, fields: Object.keys(updates) });
  if (!isSupabaseEnabled()) {
    setLocal(getLocal().map((p) => p.id === id ? { ...p, ...updates } : p));
    return { success: true };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const row = toRow({ id, ...updates }); delete row.id;
  Object.keys(row).forEach((k) => updates[mapCamel(k)] === undefined && updates[k] === undefined && delete row[k]);
  // Layer the 015 + 018 columns on top — only when the caller actually touched them.
  if (updates.companyId !== undefined) row.company_id = updates.companyId || null;
  if (updates.template  !== undefined) row.template   = updates.template  || null;
  if (updates.purchaseType !== undefined) row.purchase_type = updates.purchaseType || null;
  if (updates.gstType      !== undefined) row.gst_type      = updates.gstType      || null;
  if (updates.poDate       !== undefined) row.po_date       = updates.poDate ? toIsoDate(updates.poDate) : null;
  if (updates.cgst         !== undefined) row.cgst          = updates.cgst || null;
  if (updates.sgst         !== undefined) row.sgst          = updates.sgst || null;
  if (updates.igst         !== undefined) row.igst          = updates.igst || null;

  let { error } = await c.from("purchase_orders").update(row).eq("id", id);
  if (error && isMissingColumnError(error)) {
    console.warn("[pos:update] migration 018 columns missing — stripping purchase_type/gst_type/po_date/cgst/sgst/igst");
    delete row.purchase_type; delete row.gst_type; delete row.po_date;
    delete row.cgst; delete row.sgst; delete row.igst;
    ({ error } = await c.from("purchase_orders").update(row).eq("id", id));
  }
  if (error && isMissingColumnError(error)) {
    console.warn("[pos:update] migration 015 columns missing — stripping company_id/template");
    delete row.company_id; delete row.template;
    ({ error } = await c.from("purchase_orders").update(row).eq("id", id));
  }
  if (error) { console.error("[pos:update] failed", error); return { success: false, error: error.message }; }
  console.info("[pos:update] ok");
  return { success: true };
}
function mapCamel(snake) {
  return snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

export async function deletePO(id) {
  console.info("[pos:delete] start", { id });
  if (!isSupabaseEnabled()) { setLocal(getLocal().filter((p) => p.id !== id)); return { success: true }; }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { error } = await c.from("purchase_orders").delete().eq("id", id);
  if (error) { console.error("[pos:delete] failed", error); return { success: false, error: error.message }; }
  console.info("[pos:delete] ok");
  return { success: true };
}
