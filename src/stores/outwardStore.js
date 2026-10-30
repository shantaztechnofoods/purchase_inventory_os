// Outward Log store — public.outward_log (append-only)
import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";
import { localIsoDate } from "./localDate.js";

const LOCAL_KEY = "erp_outward";

function toRow(e) {
  return {
    event_date: e.date ? toIsoDate(e.date) : localIsoDate(),
    type:       e.type,
    ref:        e.ref || "",
    label:      e.label || null,
    units:      Number(e.units) || null,
    dept:       e.dept || null,
    serial_no:  e.serialNo || null,
    issue_id:   e.id || e.issueId || null,
    items:      e.items || [],
    note:       e.note || null,
  };
}
function fromRow(r) {
  return {
    id:       r.issue_id || r.id,
    date:     r.event_date,
    type:     r.type,
    ref:      r.ref,
    label:    r.label || "",
    units:    Number(r.units) || 0,
    dept:     r.dept || "",
    serialNo: r.serial_no || "",
    items:    Array.isArray(r.items) ? r.items : [],
    note:     r.note || "",
  };
}
function toIsoDate(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s); if (isNaN(d.getTime())) return null;
  return localIsoDate(d);
}

function getLocal() { try { const s = localStorage.getItem(LOCAL_KEY); if (s) return JSON.parse(s); } catch {} return []; }
function setLocal(a) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(a)); } catch {} }

export async function fetchOutward() {
  const mode = isSupabaseEnabled() ? "SUPABASE" : "LOCAL";
  console.info("[outward:load] start", { mode });
  if (!isSupabaseEnabled()) return getLocal();
  const c = getSupabase(); if (!c) return getLocal();
  const { data, error } = await c.from("outward_log").select("*").order("created_at", { ascending: false }).limit(500);
  if (error) { console.error("[outward:load] failed", error); return getLocal(); }
  const out = (data || []).map(fromRow);
  setLocal(out);
  console.info("[outward:load] supabase ok", { count: out.length });
  return out;
}

export async function updateOutwardRef(oldRef, newRef, newLabel) {
  console.info("[outward:updateRef] start", { oldRef, newRef });
  if (!isSupabaseEnabled()) {
    setLocal(getLocal().map((e) => e.ref !== oldRef ? e : { ...e, ref: newRef, label: newLabel }));
    return { success: true };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  // NO zero-row check here, deliberately. This is a BOM-rename cascade keyed
  // on ref, not on a row id: it legitimately updates MANY rows, and ZERO when
  // the renamed BOM has never been issued. Treating that as an error would
  // make every rename of a never-issued BOM report a failure.
  const { error } = await c.from("outward_log").update({ ref: newRef, label: newLabel }).eq("ref", oldRef);
  if (error) { console.error("[outward:updateRef] failed", error); return { success: false, error: error.message }; }
  console.info("[outward:updateRef] ok");
  return { success: true };
}

export async function createOutward(entry) {
  console.info("[outward:create] start", { ref: entry.ref, type: entry.type });
  if (!isSupabaseEnabled()) { setLocal([entry, ...getLocal()]); return { success: true, entry }; }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { data, error } = await c.from("outward_log").insert(toRow(entry)).select().single();
  if (error) { console.error("[outward:create] failed", error); return { success: false, error: error.message }; }
  console.info("[outward:create] ok");
  return { success: true, entry: fromRow(data) };
}

// Feature 3: delete an outward entry by its issue_id. Used when cancelling a
// rack build — the App layer reverses stock first, then deletes the outward
// row so reports don't double-count the issued qty.
export async function deleteOutwardByIssueId(issueId) {
  console.info("[outward:deleteByIssueId] start", { issueId });
  if (!isSupabaseEnabled()) {
    setLocal(getLocal().filter((e) => String(e.id) !== String(issueId) && String(e.issueId) !== String(issueId)));
    return { success: true };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  // Zero rows IS an error here, unlike the ref cascade above. issue_id
  // identifies one issue event, the caller only reaches this line when
  // machine.issueId is set, and that id came from the outward row itself — so
  // nothing matching means the row is gone from Postgres while local state
  // still showed it, or RLS is hiding it. A silent no-op leaves the issued qty
  // in the outward log after the stock has already been reversed, which
  // double-counts the material in every report.
  const { data, error } = await c.from("outward_log").delete().eq("issue_id", issueId).select("id");
  if (error) { console.error("[outward:deleteByIssueId] failed", error); return { success: false, error: error.message }; }
  if (!Array.isArray(data) || data.length === 0) {
    const msg = `outward entry for issue ${issueId} was not deleted — no such row, or it is not visible to this user`;
    console.error("[outward:deleteByIssueId] matched no rows", { issueId });
    return { success: false, error: msg, noRows: true };
  }
  console.info("[outward:deleteByIssueId] ok");
  return { success: true };
}
