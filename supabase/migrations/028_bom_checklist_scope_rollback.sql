-- Rollback for 028_bom_checklist_scope.sql
-- Reverts the two schema additions and restores the original RLS insert policy.

BEGIN;

DROP INDEX IF EXISTS public.checklist_responses_stage_idx;
DROP INDEX IF EXISTS public.checklist_templates_bom_scope_idx;

ALTER TABLE public.checklist_responses
  DROP COLUMN IF EXISTS stage,
  DROP COLUMN IF EXISTS bom_key;

ALTER TABLE public.checklist_templates
  DROP COLUMN IF EXISTS stage,
  DROP COLUMN IF EXISTS bom_key;

-- Restore the original RLS insert policy (finishTransfer only).
DROP POLICY IF EXISTS checklist_responses_insert ON public.checklist_responses;
CREATE POLICY checklist_responses_insert ON public.checklist_responses
  FOR INSERT TO authenticated
  WITH CHECK (submitted_by = auth.uid()
              AND public.has_permission('machines','finishTransfer'));

COMMIT;
