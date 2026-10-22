-- Rollback for 030_dept_roster_view.sql — drops the roster view.

BEGIN;

DROP VIEW IF EXISTS public.v_dept_roster;

COMMIT;
