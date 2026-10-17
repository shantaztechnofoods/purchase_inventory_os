-- 022_dept_checklists_rollback.sql
-- Apply only when reverting Phase B checklist work.
BEGIN;
DROP TABLE IF EXISTS public.checklist_responses;
DROP TABLE IF EXISTS public.checklist_templates;
COMMIT;
