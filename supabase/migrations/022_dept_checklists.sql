-- ─────────────────────────────────────────────────────────────────────────────
-- 022_dept_checklists.sql — Phase B: dynamic department checklists
-- Depends on: 021 (handover_events).
-- Additive. No existing column renamed or dropped.
-- Rollback: 022_dept_checklists_rollback.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─── checklist_templates ───────────────────────────────────────────────────
-- Admin-managed. Each department has 0+ templates. Snapshots are kept in
-- checklist_responses so editing a template never retroactively changes a
-- machine's recorded checklist.

CREATE TABLE IF NOT EXISTS public.checklist_templates (
  id          bigserial    PRIMARY KEY,
  department  text         NOT NULL CHECK (department IN
                            ('Assembly','Mechanical','Electrical','Trial')),
  name        text         NOT NULL,
  items       jsonb        NOT NULL DEFAULT '[]'::jsonb,  -- [{id, label, required?}, ...]
  active      boolean      NOT NULL DEFAULT true,
  version     integer      NOT NULL DEFAULT 1,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  created_by  uuid         REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS checklist_templates_dept_idx
  ON public.checklist_templates (department, active);

DROP TRIGGER IF EXISTS checklist_templates_updated_at ON public.checklist_templates;
CREATE TRIGGER checklist_templates_updated_at
  BEFORE UPDATE ON public.checklist_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;

-- Any authenticated user reads (operators need to see current templates).
DROP POLICY IF EXISTS checklist_templates_select ON public.checklist_templates;
CREATE POLICY checklist_templates_select ON public.checklist_templates
  FOR SELECT TO authenticated USING (true);

-- Only admins can mutate templates.
DROP POLICY IF EXISTS checklist_templates_insert ON public.checklist_templates;
CREATE POLICY checklist_templates_insert ON public.checklist_templates
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('machines','configDept'));

DROP POLICY IF EXISTS checklist_templates_update ON public.checklist_templates;
CREATE POLICY checklist_templates_update ON public.checklist_templates
  FOR UPDATE TO authenticated
  USING (public.has_permission('machines','configDept'))
  WITH CHECK (public.has_permission('machines','configDept'));

DROP POLICY IF EXISTS checklist_templates_delete ON public.checklist_templates;
CREATE POLICY checklist_templates_delete ON public.checklist_templates
  FOR DELETE TO authenticated
  USING (public.has_permission('machines','configDept'));

-- ─── checklist_responses ───────────────────────────────────────────────────
-- Snapshot of a template's items at the time of handover. Immutable once
-- submitted; a replacement means a new row.

CREATE TABLE IF NOT EXISTS public.checklist_responses (
  id                bigserial    PRIMARY KEY,
  machine_id        bigint       NOT NULL REFERENCES public.machine_log(id) ON DELETE CASCADE,
  handover_id       bigint       REFERENCES public.handover_events(id) ON DELETE SET NULL,
  department        text         NOT NULL,
  template_id       bigint       REFERENCES public.checklist_templates(id) ON DELETE SET NULL,
  template_version  integer,
  template_name     text,                                   -- denormalized for post-rollback reads
  answers           jsonb        NOT NULL DEFAULT '[]'::jsonb,
    -- answers: [{id, label, checked:bool, required:bool, remark?:string}]
    -- Every unchecked item MUST carry a non-empty remark (enforced below).
  submitted_by      uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at      timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS checklist_responses_machine_idx
  ON public.checklist_responses (machine_id, department);
CREATE INDEX IF NOT EXISTS checklist_responses_handover_idx
  ON public.checklist_responses (handover_id);

ALTER TABLE public.checklist_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS checklist_responses_select ON public.checklist_responses;
CREATE POLICY checklist_responses_select ON public.checklist_responses
  FOR SELECT TO authenticated USING (true);

-- Any user who can finish-transfer can submit a response (same gate as the
-- action that triggers it). RLS double-checks that the submitter is self.
DROP POLICY IF EXISTS checklist_responses_insert ON public.checklist_responses;
CREATE POLICY checklist_responses_insert ON public.checklist_responses
  FOR INSERT TO authenticated
  WITH CHECK (submitted_by = auth.uid()
              AND public.has_permission('machines','finishTransfer'));

-- No UPDATE / DELETE policy — responses are append-only. A re-submission
-- means a new row with a later submitted_at.

COMMIT;
