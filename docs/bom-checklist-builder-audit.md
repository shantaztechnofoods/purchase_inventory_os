# BOM-Wise Reusable Department Checklist Builder — Audit Plan

**Status:** Audit only · no code / DB / deployment change until approved
**Date:** 2026-10-21
**Author:** engineering review (SHANTAZ ERP)
**Scope:** add BOM-scoped checklist configuration (3 stages × 4 departments), reusable templates, runtime enforcement, and historical snapshots — on top of the existing BOM, Rack, Direct Production, Critical Item, department-duration, Hold, permissions, and audit flows.

---

## 1 · Current state (as it exists today)

### 1.1 BOM lifecycle
- **Table:** `public.bom_definitions` (`key`, `label`, `color`, `rack_capacity`, `items jsonb`). Shape in `src/stores/bomsStore.js:toRow / fromRow`.
- **UI:** `OutwardPage` owns BOM create + edit modals.
  - **Create:** `showCreate` state + `submitCreateBOM()` (`src/App.jsx:8886`). Fields today: `key`, `label`, `rackCapacity`, `items[]`.
  - **Edit:** inside `BOMDrawer` (`src/App.jsx:7783`), when `editMode` is on. Edits items + rack capacity + rename.
  - **Handlers (App root):** `handleCreateBOM:14794`, `handleUpdateBOM:14788`, `handleDuplicateBOM:14823`, `handleRenameBOM:14917`, `handleDeleteBOM`.
  - **Audit events:** `bom_created`, `bom_updated`, `bom_duplicated`, `bom_renamed`, `bom_deleted`.

### 1.2 Existing checklist system (migration 022, Phase B)
- **Tables:**
  - `public.checklist_templates` — admin-managed. `(id, department, name, items jsonb, active, version, created_by, created_at, updated_at)`. `department` CHECK: Assembly | Mechanical | Electrical | Trial.
  - `public.checklist_responses` — immutable snapshot at submit time. `(id, machine_id, handover_id, department, template_id, template_version, template_name, answers jsonb, submitted_by, submitted_at)`.
- **RLS:** read by any authenticated user; mutate requires `machines.configDept`; response insert requires `machines.finishTransfer`. Responses are append-only.
- **Store:** `src/stores/checklistsStore.js` — `fetchTemplates / createTemplate / updateTemplate / deleteTemplate / fetchResponses / createResponse`.
- **Pure helpers:** `src/utils/checklistLogic.js` — `startChecklistResponse`, `toggleAnswer`, `setAnswerRemark`, `validateChecklistAnswers`, `snapshotResponse`.
- **Current admin UI:** `ChecklistAdminPanel` inside Settings (`src/App.jsx:5668`). Flat, department-scoped list; no BOM linkage; no stage linkage.
- **Current runtime hookpoint:** **ONLY** on Finish & Transfer (`openFinishModal:10155` picks the newest active template for the `fromDepartment`; `submitFinishTransfer:10167` validates and snapshots the response). The Accept modal (`openAcceptModal:10216`) has **no** checklist today.

### 1.3 Gap summary vs. new requirement
| Requirement | Today | Delta |
|---|---|---|
| Template scoped to a BOM | ❌ dept only | add `bom_key` + unique index |
| Three stages per dept (Before Receive, During Work, Before Dispatch) | ❌ one slot | add `stage` enum |
| Runtime: show on Accept (Before Receive) | ❌ | wire into `submitAcceptHandover` |
| Runtime: show on Finish & Transfer (Before Dispatch) | ✅ (dept-only lookup) | tighten to BOM+stage lookup |
| Runtime: "During Work" | ❌ | new entry point — see §3.3 |
| Required-item gate before Accept/Dispatch | partial (unchecked needs remark) | preserve + reuse |
| Historical snapshot immune to template edits | ✅ (`version`, `template_name` denorm) | preserve |
| Reuse template across BOMs | manual duplication | explicit "Reuse" action + link |

---

## 2 · Proposed data model

Strictly additive. No existing column renamed or dropped. No existing row rewritten. All indexes nullable until migration completes so legacy templates keep working.

### 2.1 Migration 028 — add stage + BOM scope

```sql
-- 028_bom_checklist_scope.sql  (strictly additive, nullable defaults)

BEGIN;

ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS bom_key text REFERENCES public.bom_definitions(key)
                                       ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stage   text CHECK (stage IN
                                       ('before_receive','during_work','before_dispatch')
                                       OR stage IS NULL);

-- Templates with no bom_key remain valid as "global" / shared library templates
-- (legacy rows + the reuse-across-BOMs case). bom_key IS NOT NULL + stage IS NOT NULL
-- is the new "BOM-scoped slot" shape.
CREATE INDEX IF NOT EXISTS checklist_templates_bom_scope_idx
  ON public.checklist_templates (bom_key, department, stage, active);

ALTER TABLE public.checklist_responses
  ADD COLUMN IF NOT EXISTS stage   text CHECK (stage IN
                                       ('before_receive','during_work','before_dispatch')
                                       OR stage IS NULL),
  ADD COLUMN IF NOT EXISTS bom_key text;   -- denormalized snapshot

CREATE INDEX IF NOT EXISTS checklist_responses_stage_idx
  ON public.checklist_responses (bom_key, department, stage);

COMMIT;
```

**Rollback file (`028_bom_checklist_scope_rollback.sql`):** `DROP INDEX ... DROP COLUMN ...` in reverse. All drops `IF EXISTS`, no `CASCADE`.

**Why nullable:**
- Legacy templates stay valid (back-compat).
- The runtime lookup falls back from `(bom_key, dept, stage)` → `(dept, stage)` → `(dept, null)`, so an admin that hasn't yet created a BOM-scoped slot still sees the old behaviour.

### 2.2 No new table for the "BOM slot grid"

A BOM has 3 stages × 4 depts = **12 slot cells**. We **do not** add a `bom_checklist_links` table. A slot = *the newest active row in `checklist_templates` for `(bom_key, department, stage)`*. "Reuse" = inserting a new template row with the shared library's `items` jsonb copied in. This keeps:

- One table to query at runtime.
- Historical snapshots untouched.
- Reuse-doesn't-leak: editing one BOM's template never mutates another's row because they're independent rows.

### 2.3 Response shape additions

`checklist_responses.stage` identifies which of the three stages produced the row. `bom_key` is denormalized so Reports can filter without joining `machine_log`. Both nullable so legacy responses still render.

### 2.4 Audit event extensions

Add to `AUDIT_EVENT_TYPES`:
- `bom_checklist_configured` — one entry per BOM slot save (`{bom_key, department, stage, template_id, version, source: 'new' | 'reuse' | 'edit'}`).
- `checklist_submitted_accept` — Accept flow produced a response.
- `checklist_submitted_finish` — Finish & Transfer flow produced a response (existing path; label added for Reports).
- `checklist_submitted_during_work` — During-work snapshot.

Reuse of the existing `machines.configDept` and `machines.finishTransfer`/`accept` permissions means no new permission keys are needed.

---

## 3 · Proposed screens

### 3.1 BOM Create & Edit — new "Checklists" section
Added inside the existing `showCreate` modal AND inside `BOMDrawer` edit mode. Collapsible section after Components, titled **"Department Checklists (optional)"**.

```
Department Checklists (optional)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Assembly        Before Receive   [+ Create]  [⟲ Reuse]  [None]
                During Work      [+ Create]  [⟲ Reuse]  [None]
                Before Dispatch  [12 items ✎ Edit] [⟲ Reuse ▸ Mechanical/Mix-100]
Mechanical      Before Receive   ...
Electrical      ...
Trial           ...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

- **Create** → inline editor (reuses `ChecklistAdminPanel` item-row component extracted to a shared component — see §5).
- **Reuse** → picker dropdown listing active templates whose `department` matches the row. Includes BOM-less templates ("Shared library") and templates already attached to other BOMs. Selecting one **copies the `items` jsonb** into a NEW row scoped to this BOM; the source stays untouched.
- **Edit** → opens the inline editor pre-filled with THIS BOM's slot. Changes bump `version` and apply only here.
- **None** → no template set for this slot = no checklist at runtime for that stage.

**Not yet shipped:** a bulk "copy all stages from BOM X" shortcut. Explicit per-slot is clearer and matches the "edit should not accidentally cascade" requirement.

### 3.2 Admin → Department Checklists panel (existing)
Keep the existing `ChecklistAdminPanel`. Add two filters: **BOM** and **Stage**. Templates with `bom_key = null` surface under a "Shared library" group so admins can seed reusable templates once and link them from each BOM.

### 3.3 Runtime — three insertion points

| Stage | Trigger | Modal | Gate |
|---|---|---|---|
| **Before Receive** | `openAcceptModal` — operator about to accept into this dept | render checklist inline above the password / signature block | `Accept Machine` disabled until all required items ticked or non-empty remark |
| **During Work** | New button on the Machine card: **"During-Work Checks"** (visible only when a template exists). Not a hard gate on anything — operator can log it anytime between Accept and Finish & Transfer. | standalone modal | optional submit; writes response immediately |
| **Before Dispatch** | existing Finish & Transfer modal (already lives there) | existing UI, now BOM-scoped lookup | existing "unchecked → remark required" gate |

### 3.4 Reports
Report Center → **Checklist History** tab (new) listing `checklist_responses` with filters BOM / Department / Stage / Date. Existing report-center infra re-usable. Legacy responses (stage/bom_key NULL) still appear, grouped under "Pre-2026-11".

---

## 4 · Runtime lookup algorithm (pure, testable)

```
pickTemplate(templates, bomKey, department, stage):
  1. candidates = templates.filter(active !== false
                                   && department === dept
                                   && stage === stage)
  2. bomScoped = candidates.filter(t => t.bom_key === bomKey)
  3. if bomScoped.length  → return newest(bomScoped by updated_at)
  4. legacyDeptOnly = candidates.filter(t => t.bom_key == null && t.stage == null)
     if legacyDeptOnly.length  → return newest(legacyDeptOnly)   // pre-028 compat
  5. return null  // no template → no checklist that stage
```

Lives in `src/utils/checklistLogic.js`; replaces the single-line selector at `src/App.jsx:10162`. Unit-tested in Node (no React).

---

## 5 · Code change plan (deferred until approval)

| Change | File | Lines (approx.) | Risk |
|---|---|---|---|
| Migration 028 + rollback | `supabase/migrations/028_*.sql` | ~30 | low — additive, nullable |
| `checklistsStore` toRow/fromRow + `bomKey`/`stage` with `isMissingColumnError` retry | `src/stores/checklistsStore.js` | ~30 | low |
| `pickTemplate` helper + extended `snapshotResponse` carrying `bomKey`/`stage` | `src/utils/checklistLogic.js` | ~20 | low — pure |
| Extract checklist-item editor from `ChecklistAdminPanel` into reusable `<ChecklistEditor>` component | `src/App.jsx` | ~80 | medium — must not regress Settings panel |
| BOM Checklists section in `showCreate` modal + `BOMDrawer` edit mode | `src/App.jsx` | ~200 | medium |
| Accept-modal before_receive hookpoint | `src/App.jsx` (around `openAcceptModal:10216`) | ~60 | medium — must not break single-click default |
| During-work button + modal on Machine card | `src/App.jsx` MachinePage | ~90 | medium |
| Finish-modal lookup swap (dept-only → `pickTemplate`) | `src/App.jsx:10162` | ~5 | low |
| Report Center "Checklist History" tab | `src/App.jsx` ReportCenterPage | ~100 | low |
| Audit event-type extensions + regression inventory | `src/App.jsx` + `tests/regression.test.mjs` | ~15 | low |
| Unit tests for `pickTemplate` + extended `snapshotResponse` | `tests/checklist-scope.test.mjs` (new) | ~80 | low |

**Approximate net LOC:** ~700 lines of pure addition. No file split; stays within `src/App.jsx` convention.

---

## 6 · Migration risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Legacy templates (`bom_key = null`, `stage = null`) disappear from runtime | high if migration mishandled | explicit back-compat branch in `pickTemplate` (§4); regression test covering the legacy row shape |
| Reused template edit silently mutates other BOMs | medium — easy to design wrong | **copy on Reuse** (never link). Each BOM slot = independent `checklist_templates` row. Separate audit event per save. |
| Admin edits a template → old machine's historical response changes | low — guarded by `template_version` + `template_name` snapshot in response | preserve current snapshot shape; add unit test asserting response unchanged after a later template update |
| RLS tightening breaks reads | low | migration doesn't touch policies. Existing SELECT ∀ authenticated stays. INSERT/UPDATE still gated by `machines.configDept` |
| Accept-modal regression (single-click default breaks) | medium | checklist renders only when a template exists for `(bom_key, dept, 'before_receive')`. No template → zero change. Playwright-style end-to-end impossible; mitigated by unit test + manual QA checklist in §8 |
| BOM delete cascades to templates | low | `ON DELETE SET NULL` on `bom_key` keeps templates alive as "shared library" after a BOM is removed. No response row touched (responses already denormalize `template_name`). |
| `isMissingColumnError` client ships ahead of DB | handled | matches 026/027 pattern — stripped-on-retry so pre-028 schemas keep working |
| Supabase `bom_definitions.key` is text PK; FK must respect that | n/a | FK is `REFERENCES bom_definitions(key)`; matches current PK |
| Response row too large (jsonb bloat if items grow) | low | retain `jsonb`, no size cap change; existing index on `(machine_id, department)` kept |

Destructive operations: **none planned.** Rollback script is pure `DROP COLUMN IF EXISTS` + `DROP INDEX IF EXISTS`.

---

## 7 · Permissions

**No new permission keys.** Reuse of existing gates:
- `machines.configDept` → create/edit/delete BOM-scoped templates (both the Settings panel and the new BOM Checklists section).
- `machines.accept` → submit the `before_receive` response (same action already protected by RLS on `checklist_responses_insert`, broadened to accept too — mild RLS tweak).
- `machines.finishTransfer` → submit the `before_dispatch` response (already present).
- `machines.updateStage` or `machines.finishTransfer` → submit the `during_work` response.

The one necessary RLS adjustment is to allow a `checklist_responses` row insert when the submitter has `machines.accept` OR `machines.finishTransfer`. Current policy is `finishTransfer` only. Change proposal:

```sql
-- part of 028
DROP POLICY IF EXISTS checklist_responses_insert ON public.checklist_responses;
CREATE POLICY checklist_responses_insert ON public.checklist_responses
  FOR INSERT TO authenticated
  WITH CHECK (submitted_by = auth.uid()
              AND (public.has_permission('machines','finishTransfer')
                   OR public.has_permission('machines','accept')
                   OR public.has_permission('machines','updateStage')));
```

No permission is widened for non-dept users; only operators who already have one of these three actions can write a checklist response.

---

## 8 · Test plan

### 8.1 Unit tests (`node --test`)
- `pickTemplate` — covers:
  - exact BOM+dept+stage match returned
  - BOM-less legacy template (`bom_key=null, stage=null`) returned when no new row exists
  - inactive template skipped
  - multiple active rows → newest `updated_at` wins
  - no match → `null`
- Extended `snapshotResponse` — covers:
  - `bomKey` + `stage` echoed into response payload
  - `templateVersion` + `templateName` still carried
- `validateChecklistAnswers` — unchanged, re-run

### 8.2 Regression suite additions
- UI strings: `"Department Checklists (optional)"`, `"Before Receive"`, `"During Work"`, `"Before Dispatch"`, `"Reuse template"`, `"Checklist History"`, `"During-Work Checks"`.
- Handler names: new `handleConfigBomChecklist`, `handleSubmitAcceptChecklist`, `handleSubmitDuringWorkChecklist`.
- Audit event types: `bom_checklist_configured`, `checklist_submitted_accept`, `checklist_submitted_during_work`, `checklist_submitted_finish`.
- Store surface: no new store exports (reuses `createTemplate` + `updateTemplate` + `createResponse`).

### 8.3 Manual QA checklist (pre-prod)
1. **Create BOM** without touching Checklists section → BOM saves, no checklist rows written. ✓ existing flow intact.
2. **Create BOM** → fill Assembly / Before Dispatch slot inline → save → verify 1 template row with `bom_key` set.
3. **Edit the same BOM** → tweak that template → verify `version` bumped, item unchanged on a DIFFERENT BOM.
4. **Reuse** flow: open BOM-B, pick BOM-A's Assembly template → verify a NEW row is created for BOM-B; BOM-A's row untouched.
5. **Delete BOM-A** → verify BOM-A's templates get `bom_key = NULL` (now in shared library) and BOM-B's reused copy is unaffected.
6. **Runtime Accept** on a machine whose BOM has a `before_receive` template → modal shows checklist, Accept blocked until required items satisfied or remarks added.
7. **Runtime Accept** on a machine whose BOM has NO template → single-click accept behaves identically to today.
8. **Runtime During-Work** → button appears; submit creates a response row; machine stage unchanged.
9. **Runtime Finish & Transfer** → BOM-scoped template used over any dept-only legacy template.
10. **After submit**: edit the template → confirm earlier `checklist_responses` row's answers / template_name / version unchanged.
11. **Reports → Checklist History** → filters by BOM / Dept / Stage all return correct subsets.
12. **Permissions**: a user without `machines.configDept` sees the BOM Checklists section in read-only mode; the "Reuse" button exists but the "Save" button is hidden.
13. **Offline localStorage mode** (`VITE_USE_SUPABASE=false`) → create + edit + reuse all work; responses persist in `localStorage.erp_checklist_responses`.

### 8.4 Pre-flight non-destructive DB probe (prod, pre-deploy)
```sql
-- Confirms there are no existing checklist_templates rows that would conflict
-- with the new indexes (unique keys here are NOT being added, so this is a soft
-- probe only).
SELECT department, COUNT(*) FROM public.checklist_templates GROUP BY department;
SELECT COUNT(*) AS legacy_bom_null  FROM public.checklist_templates WHERE bom_key IS NULL;
SELECT COUNT(*) AS existing_rows    FROM public.checklist_responses;
```

Expected: zero errors, counts match current operational numbers.

---

## 9 · Decisions (approved 2026-10-21)

1. **During-Work checklist is optional per BOM/department.** If configured, required items must be completed before the During-Work submission. Not a prerequisite for Finish & Transfer.
2. **Legacy templates preserved.** Pre-028 templates (`bom_key = NULL`) continue to drive runtime behaviour for any BOM/machine with no BOM-specific slot configured. The `pickTemplate` fallback (§4) is normative.
3. **Reuse is copy, not link.** Selecting an existing template in a BOM slot **copies its items** into a fresh `checklist_templates` row scoped to that BOM. No shared live reference.
4. **Template edits are forward-only.** A later edit to a template never alters a `checklist_responses` row already submitted (immutable snapshot) and never alters other BOMs' slots. In-flight machines complete their journey on the version they were created against.
5. **Usability constraint.** UI must be approachable for low-literacy / low-computer-experience operators: short Hindi/Gujarati-neutral English labels, big tap targets, dropdowns over free-text, sensible defaults, few clicks, "Save & Next" patterns.

## 10 · Approval

Status: **approved** · 2026-10-21.

Implementation sequence (same as migrations 026/027):
branch → migration + rollback → store + utils → UI → tests → `npm test` + `npm run build` → commit → push → CI → `supabase db query --linked` → merge to `main` → Vercel verify.
