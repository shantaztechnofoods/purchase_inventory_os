-- ─────────────────────────────────────────────────────────────────────────────
-- 028_bom_checklist_scope.sql — BOM-wise reusable Department Checklists.
-- Depends on: 022 (checklist_templates / checklist_responses).
--
-- Adds optional BOM-scope + 3-stage lane to the existing Phase-B checklists.
-- Strictly additive, all new columns nullable so legacy rows keep working
-- and the pickTemplate helper can fall back to department-only matches.
--
-- Stages:
--   before_receive   — shown in the Accept modal
--   during_work      — optional, shown via a Machine-card button
--   before_dispatch  — shown in the Finish & Transfer modal (today's slot)
--
-- Reuse semantics: a BOM slot = the newest active row filtered by
-- (bom_key, department, stage). "Reuse" copies items into a NEW row scoped
-- to that BOM — no shared live reference. See docs/bom-checklist-builder-audit.md.
--
-- Strictly additive. Nullable. No destructive op; no RLS tightening.
-- RLS INSERT policy on checklist_responses is widened so Accept + updateStage
-- callers can submit responses (today it's finishTransfer only). The checker
-- still enforces submitted_by = auth.uid() so no unrelated user can forge.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── checklist_templates: bom_key + stage ─────────────────────────────────
ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS bom_key text REFERENCES public.bom_definitions(key)
                                       ON UPDATE CASCADE ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stage   text CHECK (stage IN
                                       ('before_receive','during_work','before_dispatch')
                                       OR stage IS NULL);

CREATE INDEX IF NOT EXISTS checklist_templates_bom_scope_idx
  ON public.checklist_templates (bom_key, department, stage, active);

-- ─── checklist_responses: stage + bom_key denorm ──────────────────────────
ALTER TABLE public.checklist_responses
  ADD COLUMN IF NOT EXISTS stage   text CHECK (stage IN
                                       ('before_receive','during_work','before_dispatch')
                                       OR stage IS NULL),
  ADD COLUMN IF NOT EXISTS bom_key text;

CREATE INDEX IF NOT EXISTS checklist_responses_stage_idx
  ON public.checklist_responses (bom_key, department, stage);

-- ─── RLS: widen insert to accept + updateStage callers ────────────────────
-- Keeps submitted_by = auth.uid() self-check so a user cannot forge another's
-- submission. Original policy accepted only finishTransfer holders; the three
-- new runtime hookpoints (Accept, During-Work, Finish) each use a different
-- permission, so we accept any of the three.
DROP POLICY IF EXISTS checklist_responses_insert ON public.checklist_responses;
CREATE POLICY checklist_responses_insert ON public.checklist_responses
  FOR INSERT TO authenticated
  WITH CHECK (submitted_by = auth.uid()
              AND (public.has_permission('machines','finishTransfer')
                   OR public.has_permission('machines','accept')
                   OR public.has_permission('machines','updateStage')));

COMMIT;
