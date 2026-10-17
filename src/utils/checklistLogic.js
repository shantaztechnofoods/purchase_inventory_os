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

// Update a single answer's remark text.
export function setAnswerRemark(answers, idx, remark) {
  return (answers || []).map((a, i) => i === idx ? { ...a, remark: String(remark || "") } : a);
}

// Validation: every unchecked item MUST have a non-empty remark before
// the handover can be submitted. Returns { ok, missing: [index, index...] }
// so the UI can highlight each failed row.
export function validateChecklistAnswers(answers) {
  const missing = [];
  (answers || []).forEach((a, i) => {
    if (!a.checked && !(a.remark && a.remark.trim())) missing.push(i);
  });
  return { ok: missing.length === 0, missing };
}

// Snapshot a response row for DB insert. Includes template id + version
// so a later template edit never retroactively mutates history.
export function snapshotResponse({ machineId, handoverId, department, template, answers, submittedBy }) {
  return {
    machineId,
    handoverId: handoverId || null,
    department,
    templateId:      template?.id || null,
    templateVersion: template?.version ?? 1,
    templateName:    template?.name || null,
    answers:         Array.isArray(answers) ? answers : [],
    submittedBy:     submittedBy || null,
  };
}
