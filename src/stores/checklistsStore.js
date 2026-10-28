// Checklist templates + responses — public.checklist_templates / public.checklist_responses
// Same gating pattern as posStore / handoverStore.

import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

const T_LOCAL = "erp_checklist_templates";
const R_LOCAL = "erp_checklist_responses";

// Migration 028 — bomKey / stage columns. Null is a valid "shared library" /
// "legacy dept-only" value. The isMissingColumnError retry below strips the
// two new columns when the DB hasn't been migrated yet, so the client ships
// safely ahead of the schema.
const tTo   = (t) => {
  const row = {
    department: t.department,
    name:       t.name,
    items:      t.items || [],
    active:     t.active !== false,
    version:    Number(t.version) || 1,
  };
  if (t.bomKey !== undefined) row.bom_key = t.bomKey || null;
  if (t.stage  !== undefined) row.stage   = t.stage  || null;
  return row;
};
const tFrom = (r) => ({
  id:         r.id,
  department: r.department,
  name:       r.name,
  items:      Array.isArray(r.items) ? r.items : [],
  active:     r.active !== false,
  version:    Number(r.version) || 1,
  bomKey:     r.bom_key || null,
  stage:      r.stage   || null,
  createdAt:  r.created_at || null,
  updatedAt:  r.updated_at || null,
});

const rTo   = (r) => {
  const row = {
    machine_id:       r.machineId,
    handover_id:      r.handoverId || null,
    department:       r.department,
    template_id:      r.templateId || null,
    template_version: r.templateVersion ?? 1,
    template_name:    r.templateName || null,
    answers:          r.answers || [],
    submitted_by:     r.submittedBy || null,
  };
  if (r.stage  !== undefined) row.stage   = r.stage  || null;
  if (r.bomKey !== undefined) row.bom_key = r.bomKey || null;
  return row;
};
const rFrom = (row) => ({
  id: row.id, machineId: row.machine_id, handoverId: row.handover_id || null,
  department: row.department, templateId: row.template_id || null,
  templateVersion: row.template_version ?? 1, templateName: row.template_name || "",
  answers: Array.isArray(row.answers) ? row.answers : [],
  stage:   row.stage   || null,
  bomKey:  row.bom_key || null,
  submittedBy: row.submitted_by || null, submittedAt: row.submitted_at || null,
});

// Detects "column does not exist" / schema-cache errors so we can retry
// without the new 028 columns when the migration hasn't been run. Same
// pattern as itemsStore / machinesStore.
function isMissingColumnError(err) {
  if (!err) return false;
  if (err.code === "42703" || err.code === "PGRST204") return true;
  return /column .* does not exist|schema cache|could not find the .* column/i.test(err.message || err.details || err.hint || "");
}

const getLocalT  = () => { try { const s = localStorage.getItem(T_LOCAL); if (s) return JSON.parse(s); } catch {} return []; };
const setLocalT  = (a) => { try { localStorage.setItem(T_LOCAL, JSON.stringify(a)); } catch {} };
const getLocalR  = () => { try { const s = localStorage.getItem(R_LOCAL); if (s) return JSON.parse(s); } catch {} return []; };
const setLocalR  = (a) => { try { localStorage.setItem(R_LOCAL, JSON.stringify(a)); } catch {} };

export async function fetchTemplates() {
  if (!isSupabaseEnabled()) return getLocalT();
  const c = getSupabase(); if (!c) return getLocalT();
  const { data, error } = await c.from("checklist_templates").select("*").order("department").order("name");
  if (error) { console.warn("[checklists:templates] load failed", error); return getLocalT(); }
  const out = (data || []).map(tFrom);
  setLocalT(out);
  return out;
}

export async function createTemplate(t) {
  if (!isSupabaseEnabled()) {
    const row = { id: Date.now(), ...tFrom({ ...tTo(t), created_at: new Date().toISOString() }) };
    setLocalT([row, ...getLocalT()]);
    return { success: true, template: row };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const fullRow = tTo(t);
  let { data, error } = await c.from("checklist_templates").insert(fullRow).select().single();
  if (error && isMissingColumnError(error)) {
    console.warn("[checklists:create] migration 028 columns missing — retrying without bom_key/stage");
    const slim = { ...fullRow }; delete slim.bom_key; delete slim.stage;
    ({ data, error } = await c.from("checklist_templates").insert(slim).select().single());
  }
  if (error) { console.error("[checklists:create] failed", error); return { success: false, error: error.message }; }
  return { success: true, template: tFrom(data) };
}

export async function updateTemplate(id, patch) {
  if (!isSupabaseEnabled()) {
    const all = getLocalT().map((t) => t.id === id ? { ...t, ...patch, version: (t.version || 1) + 1 } : t);
    setLocalT(all);
    return { success: true };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  // Bump version so any renderer that caches by (id, version) picks the fresh copy.
  const row = {};
  if (patch.name       !== undefined) row.name       = patch.name;
  if (patch.department !== undefined) row.department = patch.department;
  if (patch.items      !== undefined) row.items      = patch.items;
  if (patch.active     !== undefined) row.active     = !!patch.active;
  if (patch.bomKey     !== undefined) row.bom_key    = patch.bomKey || null;
  if (patch.stage      !== undefined) row.stage      = patch.stage  || null;
  // Fetch current version to bump
  const { data: cur } = await c.from("checklist_templates").select("version").eq("id", id).maybeSingle();
  row.version = (cur?.version || 1) + 1;
  // `.select("id")` is load-bearing: without it PostgREST answers an UPDATE
  // that matched ZERO rows with no error and no data, and this function
  // reported success for a write that never happened. Zero rows means either
  // no such id or an RLS policy hiding the row from this user — both are
  // failures the caller must see. Same trap as machinesStore.updateMachine.
  // The 028 retry below carries the .select() too, since that retry is the
  // call that actually lands on a pre-028 schema.
  let { data, error } = await c.from("checklist_templates").update(row).eq("id", id).select("id");
  if (error && isMissingColumnError(error)) {
    console.warn("[checklists:update] migration 028 columns missing — retrying without bom_key/stage");
    const slim = { ...row }; delete slim.bom_key; delete slim.stage;
    ({ data, error } = await c.from("checklist_templates").update(slim).eq("id", id).select("id"));
  }
  if (error) { console.error("[checklists:update] failed", error); return { success: false, error: error.message }; }
  if (!Array.isArray(data) || data.length === 0) {
    const msg = `checklist template ${id} was not updated — no such row, or it is not visible to this user`;
    console.error("[checklists:update] matched no rows", { id });
    return { success: false, error: msg, noRows: true };
  }
  return { success: true };
}

export async function deleteTemplate(id) {
  if (!isSupabaseEnabled()) {
    setLocalT(getLocalT().filter((t) => t.id !== id));
    return { success: true };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  // Same zero-row trap as updateTemplate: a DELETE matching nothing is not an
  // error to PostgREST, so a template the operator lacks rights to remove
  // would vanish from the UI and reappear on the next reload.
  const { data, error } = await c.from("checklist_templates").delete().eq("id", id).select("id");
  if (error) { console.error("[checklists:delete] failed", error); return { success: false, error: error.message }; }
  if (!Array.isArray(data) || data.length === 0) {
    const msg = `checklist template ${id} was not deleted — no such row, or it is not visible to this user`;
    console.error("[checklists:delete] matched no rows", { id });
    return { success: false, error: msg, noRows: true };
  }
  return { success: true };
}

export async function fetchResponses() {
  if (!isSupabaseEnabled()) return getLocalR();
  const c = getSupabase(); if (!c) return getLocalR();
  const { data, error } = await c.from("checklist_responses").select("*").order("submitted_at", { ascending: false });
  if (error) { console.warn("[checklists:responses] load failed", error); return getLocalR(); }
  const out = (data || []).map(rFrom);
  setLocalR(out);
  return out;
}

export async function createResponse(r) {
  if (!isSupabaseEnabled()) {
    const row = { id: Date.now(), submittedAt: new Date().toISOString(), ...r };
    setLocalR([row, ...getLocalR()]);
    return { success: true, response: row };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const fullRow = rTo(r);
  let { data, error } = await c.from("checklist_responses").insert(fullRow).select().single();
  if (error && isMissingColumnError(error)) {
    console.warn("[checklists:response] migration 028 columns missing — retrying without stage/bom_key");
    const slim = { ...fullRow }; delete slim.stage; delete slim.bom_key;
    ({ data, error } = await c.from("checklist_responses").insert(slim).select().single());
  }
  if (error) { console.error("[checklists:response] failed", error); return { success: false, error: error.message }; }
  return { success: true, response: rFrom(data) };
}
