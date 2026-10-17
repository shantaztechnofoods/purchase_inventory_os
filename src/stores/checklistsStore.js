// Checklist templates + responses — public.checklist_templates / public.checklist_responses
// Same gating pattern as posStore / handoverStore.

import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

const T_LOCAL = "erp_checklist_templates";
const R_LOCAL = "erp_checklist_responses";

const tTo   = (t) => ({ department: t.department, name: t.name, items: t.items || [], active: t.active !== false, version: Number(t.version) || 1 });
const tFrom = (r) => ({ id: r.id, department: r.department, name: r.name, items: Array.isArray(r.items) ? r.items : [], active: r.active !== false, version: Number(r.version) || 1, createdAt: r.created_at || null, updatedAt: r.updated_at || null });

const rTo   = (r) => ({
  machine_id:       r.machineId,
  handover_id:      r.handoverId || null,
  department:       r.department,
  template_id:      r.templateId || null,
  template_version: r.templateVersion ?? 1,
  template_name:    r.templateName || null,
  answers:          r.answers || [],
  submitted_by:     r.submittedBy || null,
});
const rFrom = (row) => ({
  id: row.id, machineId: row.machine_id, handoverId: row.handover_id || null,
  department: row.department, templateId: row.template_id || null,
  templateVersion: row.template_version ?? 1, templateName: row.template_name || "",
  answers: Array.isArray(row.answers) ? row.answers : [],
  submittedBy: row.submitted_by || null, submittedAt: row.submitted_at || null,
});

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
  const { data, error } = await c.from("checklist_templates").insert(tTo(t)).select().single();
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
  // Fetch current version to bump
  const { data: cur } = await c.from("checklist_templates").select("version").eq("id", id).maybeSingle();
  row.version = (cur?.version || 1) + 1;
  const { error } = await c.from("checklist_templates").update(row).eq("id", id);
  if (error) { console.error("[checklists:update] failed", error); return { success: false, error: error.message }; }
  return { success: true };
}

export async function deleteTemplate(id) {
  if (!isSupabaseEnabled()) {
    setLocalT(getLocalT().filter((t) => t.id !== id));
    return { success: true };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { error } = await c.from("checklist_templates").delete().eq("id", id);
  if (error) { console.error("[checklists:delete] failed", error); return { success: false, error: error.message }; }
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
  const { data, error } = await c.from("checklist_responses").insert(rTo(r)).select().single();
  if (error) { console.error("[checklists:response] failed", error); return { success: false, error: error.message }; }
  return { success: true, response: rFrom(data) };
}
