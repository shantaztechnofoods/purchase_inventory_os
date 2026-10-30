// Pure helpers for checklist templates and responses.
// Zero React / zero DOM — unit-testable in Node.

// A checklist template looks like:
//   { id, department, name, items: [{ id, label, required?: bool }], active, version }
//
// A response snapshots the items at submit time:
//   { machine_id, handover_id?, department, template_id, template_version, template_name,
//     answers: [{ id, label, checked, required, remark?: string }], submitted_by, submitted_at }

// Build an initial answers array for a given template. Every item is
// unchecked and has no remark by default.
export function startChecklistResponse(template) {
  if (!template || !Array.isArray(template.items)) return [];
  return template.items.map((it) => ({
    id:       it.id || null,
    label:    it.label || "",
    required: !!it.required,
    checked:  false,
    remark:   "",
  }));
}

// Toggle a single answer's checked flag; clears remark when checked.
export function toggleAnswer(answers, idx, value) {
  return (answers || []).map((a, i) => i === idx
    ? { ...a, checked: !!value, remark: value ? "" : a.remark }
    : a
  );
}

// Tick or untick every answer at once.
//
// Why this exists: a 20-item checklist was 20 taps, at every department, on
// every machine, on a tablet. The overwhelming majority of steps pass, so the
// cheap order is "all OK, then untick the exceptions" rather than "tick twenty
// things". This does NOT weaken the record: validateChecklistAnswers still
// demands a written reason for every unticked item, so the exceptions are
// exactly as well documented as before — and now they are the only rows the
// operator had to think about.
//
// Ticking clears remarks, matching toggleAnswer. Unticking preserves them, so
// "All OK" followed by "Clear" does not destroy a reason already typed.
export function setAllAnswers(answers, value) {
  const checked = !!value;
  return (answers || []).map((a) => ({
    ...a,
    checked,
    remark: checked ? "" : a.remark,
  }));
}

// How many answers are ticked. Used for the "8 / 20 ticked" counter next to
// the All OK control.
export function countChecked(answers) {
  return (answers || []).filter((a) => a && a.checked).length;
}

// Update a single answer's remark text.
export function setAnswerRemark(answers, idx, remark) {
  return (answers || []).map((a, i) => i === idx ? { ...a, remark: String(remark || "") } : a);
}

// Validation before a handover can be submitted (2026-10-30, agreed rule):
// every unticked item — "Must do" or not — needs a written reason. With the
// reason the operator may continue; the incomplete item is then raised as a
// pending job against the machine (see incompleteChecklistJobs), so nothing
// is skipped silently. Returns { ok, missing, requiredMissing } (indexes);
// `ok` depends only on `missing`. `requiredMissing` is kept for display.
export function validateChecklistAnswers(answers) {
  const missing = [];
  const requiredMissing = [];
  (answers || []).forEach((a, i) => {
    if (!a.checked && !(a.remark && a.remark.trim())) missing.push(i);
    if (!a.checked && a.required) requiredMissing.push(i);
  });
  return { ok: missing.length === 0, missing, requiredMissing };
}
// One sentence for the operator, from a validate result.
export function checklistProblemText(chk) {
  if (!chk || chk.ok) return "";
  return `Write the reason for ${chk.missing.length} unticked item${chk.missing.length === 1 ? "" : "s"} — it is saved as a pending job on this machine.`;
}
// Every unticked item (with its reason) as a pending job to raise against the
// machine. `stageLabel` is "Before Transfer" / "After Acceptance".
export function incompleteChecklistJobs(answers, stageLabel) {
  return (answers || [])
    .filter((a) => a && !a.checked)
    .map((a) => ({
      description: `Checklist not completed (${stageLabel}): ${String(a.label || "").trim() || "item"}${a.required ? " · Must do" : ""}`,
      itemCode: "", itemName: "", qty: null,
      reason: String(a.remark || "").trim(),
    }));
}

export function snapshotResponse({ machineId, handoverId, department, template, answers, submittedBy, stage, bomKey }) {
  return {
    machineId,
    handoverId: handoverId || null,
    department,
    stage:  stage  || null,
    bomKey: bomKey || null,
    templateId:      template?.id || null,
    templateVersion: template?.version ?? 1,
    templateName:    template?.name || null,
    answers:         Array.isArray(answers) ? answers : [],
    submittedBy:     submittedBy || null,
  };
}

// ─── pickTemplate ───────────────────────────────────────────────────────────
// Migration 028 — resolve the right checklist template for a given BOM slot
// at runtime. Fallback cascade (first non-empty wins):
//   1. BOM-scoped exact match          (bom_key = bomKey AND stage = stage)
//   2. Legacy dept-only template       (bom_key IS NULL AND stage IS NULL)
//
// Only active templates are candidates. Ties within a step break on
// updated_at desc, with id desc as a stable tiebreaker.
//
// Returns the template object or null when no template is configured for
// this slot (= no checklist runs at that runtime hookpoint).
export function pickTemplate(templates, bomKey, department, stage) {
  if (!Array.isArray(templates) || !department) return null;
  const active = templates.filter((t) => t && t.active !== false && t.department === department);
  const sorted = (arr) => arr.slice().sort((a, b) => {
    const au = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bu = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    if (bu !== au) return bu - au;
    return (b.id || 0) - (a.id || 0);
  });

  if (bomKey && stage) {
    const scoped = active.filter((t) => t.bomKey === bomKey && t.stage === stage);
    if (scoped.length) return sorted(scoped)[0];
  }
  // Legacy fallback: dept-only templates (bom_key=null AND stage=null) still
  // drive the before_dispatch slot for any BOM that hasn't configured its own
  // slot. This is the back-compat guarantee from the audit (§9 decision 2).
  // We only fall back when the operator asked for the Finish stage, or when
  // the caller passed no bomKey/stage at all — a legacy template is NOT a
  // valid "before_receive" or "during_work" default, because those slots are
  // new in 028 and have no legacy equivalent.
  if (!bomKey || !stage || stage === "before_dispatch") {
    const legacy = active.filter((t) => !t.bomKey && !t.stage);
    if (legacy.length) return sorted(legacy)[0];
  }
  return null;
}

// Duplicate a template's items for the "Reuse" button in the BOM Checklists
// section. Pure, so unit tests can lock the shape. Each item gets a fresh id
// so the copy's answers never collide with the source template's responses.
export function duplicateTemplateItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((it, idx) => ({
    id:       `i${Date.now()}-${idx}`,
    label:    (it && it.label) || "",
    required: !!(it && it.required),
  }));
}
