// Unit tests for src/utils/checklistLogic.js — pure functions.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startChecklistResponse, toggleAnswer, setAnswerRemark,
  validateChecklistAnswers, snapshotResponse,
} from "../src/utils/checklistLogic.js";

const TEMPLATE = {
  id: 1, department: "Mechanical", name: "Assembly QC", version: 2,
  items: [
    { id: "a", label: "Bolts torqued",  required: true  },
    { id: "b", label: "Oil topped up",  required: false },
    { id: "c", label: "Trial run smooth", required: true },
  ],
};

test("startChecklistResponse: creates one answer per template item, unchecked", () => {
  const answers = startChecklistResponse(TEMPLATE);
  assert.equal(answers.length, 3);
  assert.equal(answers.every((a) => a.checked === false), true);
  assert.equal(answers.every((a) => a.remark === ""), true);
  assert.equal(answers[0].required, true);
  assert.equal(answers[1].required, false);
});

test("startChecklistResponse: null / malformed template → []", () => {
  assert.deepEqual(startChecklistResponse(null), []);
  assert.deepEqual(startChecklistResponse({}), []);
  assert.deepEqual(startChecklistResponse({ items: "not-array" }), []);
});

test("toggleAnswer: flips checked and clears remark when checking", () => {
  const base = [{ id: "a", label: "X", required: true, checked: false, remark: "wasn't done" }];
  const next = toggleAnswer(base, 0, true);
  assert.equal(next[0].checked, true);
  assert.equal(next[0].remark, "");  // cleared on check
});

test("toggleAnswer: unchecking preserves existing remark", () => {
  const base = [{ id: "a", label: "X", required: true, checked: true, remark: "earlier note" }];
  const next = toggleAnswer(base, 0, false);
  assert.equal(next[0].checked, false);
  assert.equal(next[0].remark, "earlier note");
});

test("setAnswerRemark: updates remark for the right row only", () => {
  const base = [
    { id: "a", label: "X", required: true, checked: false, remark: "" },
    { id: "b", label: "Y", required: true, checked: false, remark: "" },
  ];
  const next = setAnswerRemark(base, 1, "needs rework");
  assert.equal(next[0].remark, "");
  assert.equal(next[1].remark, "needs rework");
});

test("validateChecklistAnswers: all checked → ok", () => {
  const answers = [{ checked: true }, { checked: true }];
  const r = validateChecklistAnswers(answers);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missing, []);
});

test("validateChecklistAnswers: unchecked without remark → missing", () => {
  const answers = [
    { checked: true },
    { checked: false, remark: "" },
    { checked: false, remark: "has note" },
  ];
  const r = validateChecklistAnswers(answers);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, [1]);
});

test("validateChecklistAnswers: unchecked with whitespace-only remark → missing", () => {
  const answers = [{ checked: false, remark: "   " }];
  const r = validateChecklistAnswers(answers);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, [0]);
});

test("snapshotResponse: captures template id + version so edits never move history", () => {
  const answers = startChecklistResponse(TEMPLATE);
  const snap = snapshotResponse({
    machineId: 42, handoverId: 99, department: "Mechanical",
    template: TEMPLATE, answers, submittedBy: "user-1",
  });
  assert.equal(snap.machineId, 42);
  assert.equal(snap.handoverId, 99);
  assert.equal(snap.department, "Mechanical");
  assert.equal(snap.templateId, 1);
  assert.equal(snap.templateVersion, 2);
  assert.equal(snap.templateName, "Assembly QC");
  assert.equal(snap.submittedBy, "user-1");
  assert.equal(snap.answers.length, 3);
});

test("snapshotResponse: nulls out missing handoverId and submittedBy", () => {
  const snap = snapshotResponse({
    machineId: 1, department: "Trial", template: TEMPLATE, answers: [],
  });
  assert.equal(snap.handoverId, null);
  assert.equal(snap.submittedBy, null);
});
