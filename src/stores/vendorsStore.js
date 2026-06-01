// Vendors store — public.vendors CRUD with local fallback.
import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

const LOCAL_KEY = "erp_vendors";

// Archive sentinel — when a vendor has POs / items, deleteVendor sets status='archived'
// (encoded in the notes payload since the vendors table has no dedicated archive column,
// and adding one requires a migration we can't run from this client). Archived vendors
// are filtered out of the active list by the UI but preserved for PO/item history joins.
const ARCHIVED_MARKER = "__archived__";

function toRow(v) {
  return {
    id:             v.id || undefined,
    name:           v.name,
    category:       v.category       || null,
    contact_person: v.contactPerson  || null,
    phone:          v.phone          || null,
    email:          v.email          || null,
    gst:            v.gst            || null,
    address:        v.address        || null,
    city:           v.city           || null,
    notes:          v.archived
                      ? `${ARCHIVED_MARKER} ${v.notes || ""}`.trim()
                      : (v.notes || null),
  };
}
function fromRow(r) {
  const notes = r.notes || "";
  const archived = notes.startsWith(ARCHIVED_MARKER);
  return {
    id:            r.id,
    name:          r.name,
    category:      r.category       || "",
    contactPerson: r.contact_person || "",
    phone:         r.phone          || "",
    email:         r.email          || "",
    gst:           r.gst            || "",
    address:       r.address        || "",
    city:          r.city           || "",
    notes:         archived ? notes.slice(ARCHIVED_MARKER.length).trim() : notes,
    archived,
  };
}

function getLocal() {
  try { const s = localStorage.getItem(LOCAL_KEY); if (s) return JSON.parse(s); } catch {}
  return [];
}
function setLocal(list) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch {}
}

export async function listVendors() {
  const mode = isSupabaseEnabled() ? "SUPABASE" : "LOCAL";
  console.info("[vendors:list] start", { mode });
  if (!isSupabaseEnabled()) {
    const list = getLocal();
    console.info("[vendors:list] local ok", { count: list.length });
    return list;
  }
  const c = getSupabase();
  if (!c) { console.warn("[vendors:list] client null, local fallback"); return getLocal(); }
  const { data, error } = await c.from("vendors").select("*").order("name", { ascending: true });
  if (error) { console.error("[vendors:list] supabase error", error); return getLocal(); }
  const list = (data || []).map(fromRow);
  setLocal(list);
  console.info("[vendors:list] supabase ok", { count: list.length });
  return list;
}

export async function createVendor(v) {
  console.info("[vendors:create] start", { name: v.name });
  if (!isSupabaseEnabled()) {
    const id = v.id || `v_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;
    const newV = { ...v, id };
    setLocal([...getLocal(), newV]);
    console.info("[vendors:create] local ok", { id });
    return { success: true, vendor: newV };
  }
  const c = getSupabase();
  if (!c) return { success: false, error: "Supabase not configured" };
  const row = toRow(v); delete row.id;
  const { data, error } = await c.from("vendors").insert(row).select().single();
  if (error) { console.error("[vendors:create] failed", error); return { success: false, error: error.message }; }
  const newV = fromRow(data);
  setLocal([...getLocal(), newV]);
  console.info("[vendors:create] supabase ok", { id: newV.id });
  return { success: true, vendor: newV };
}

export async function updateVendor(v) {
  console.info("[vendors:update] start", { id: v.id });
  if (!isSupabaseEnabled()) {
    setLocal(getLocal().map((x) => x.id === v.id ? v : x));
    console.info("[vendors:update] local ok");
    return { success: true, vendor: v };
  }
  const c = getSupabase();
  if (!c) return { success: false, error: "Supabase not configured" };
  const row = toRow(v); const id = row.id; delete row.id;
  const { data, error } = await c.from("vendors").update(row).eq("id", id).select().single();
  if (error) { console.error("[vendors:update] failed", error); return { success: false, error: error.message }; }
  const updated = fromRow(data);
  setLocal(getLocal().map((x) => x.id === updated.id ? updated : x));
  console.info("[vendors:update] supabase ok");
  return { success: true, vendor: updated };
}

// Hard delete a vendor row. Used by the App handler when the vendor has no purchase
// history / POs / linked items — no FK ripple to worry about.
export async function deleteVendor(id) {
  console.info("[vendors:delete] start", { id });
  if (!isSupabaseEnabled()) {
    setLocal(getLocal().filter((v) => v.id !== id));
    console.info("[vendors:delete] local ok");
    return { success: true };
  }
  const c = getSupabase();
  if (!c) return { success: false, error: "Supabase not configured" };
  const { error } = await c.from("vendors").delete().eq("id", id);
  if (error) { console.error("[vendors:delete] failed", error); return { success: false, error: error.message }; }
  setLocal(getLocal().filter((v) => v.id !== id));
  console.info("[vendors:delete] supabase ok");
  return { success: true };
}

// Archive a vendor (keeps the row so PO history / item-link references stay intact,
// but the vendor disappears from active selectors). Implemented as an update of the
// notes column with a marker prefix — see toRow/fromRow.
export async function archiveVendor(vendor) {
  console.info("[vendors:archive] start", { id: vendor?.id, name: vendor?.name });
  const archived = { ...vendor, archived: true };
  if (!isSupabaseEnabled()) {
    setLocal(getLocal().map((v) => v.id === archived.id ? archived : v));
    console.info("[vendors:archive] local ok");
    return { success: true, vendor: archived };
  }
  const c = getSupabase();
  if (!c) return { success: false, error: "Supabase not configured" };
  const row = toRow(archived); const rid = row.id; delete row.id;
  const { data, error } = await c.from("vendors").update(row).eq("id", rid).select().single();
  if (error) { console.error("[vendors:archive] failed", error); return { success: false, error: error.message }; }
  const updated = fromRow(data);
  setLocal(getLocal().map((v) => v.id === updated.id ? updated : v));
  console.info("[vendors:archive] supabase ok");
  return { success: true, vendor: updated };
}

export async function bulkCreateVendors(arr) {
  console.info("[vendors:bulkCreate] start", { count: arr.length });
  if (!isSupabaseEnabled()) {
    const out = arr.map((v) => ({ ...v, id: v.id || `v_${Date.now()}_${Math.random().toString(36).slice(2,7)}` }));
    setLocal([...getLocal(), ...out]);
    console.info("[vendors:bulkCreate] local ok");
    return { success: true, vendors: out };
  }
  const c = getSupabase();
  if (!c) return { success: false, error: "Supabase not configured" };
  const rows = arr.map((v) => { const r = toRow(v); delete r.id; return r; });
  const { data, error } = await c.from("vendors").insert(rows).select();
  if (error) { console.error("[vendors:bulkCreate] failed", error); return { success: false, error: error.message }; }
  const out = (data || []).map(fromRow);
  setLocal([...getLocal(), ...out]);
  console.info("[vendors:bulkCreate] supabase ok", { count: out.length });
  return { success: true, vendors: out };
}
