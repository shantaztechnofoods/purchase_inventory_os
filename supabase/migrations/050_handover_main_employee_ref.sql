-- ─────────────────────────────────────────────────────────────────────────────
-- 050_handover_main_employee_ref.sql — Main Employee without an ERP login
--
-- 2026-10-31: the Finish & Transfer Main / Responsible Employee may be any
-- employee of the department, including one added in Settings → Employees
-- with no ERP login. main_employee_id (uuid → auth.users) stays for login
-- users; a non-login main is recorded as main_employee_ref ("emp:<id>") and
-- main_employee_name, and is flagged main:true in worked_by_snapshot. The
-- drawn signature is stored per hand-over as before.
-- Additive, nullable. No RLS change. Rollback: 050_…_rollback.sql
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;
ALTER TABLE public.handover_events
  ADD COLUMN IF NOT EXISTS main_employee_ref  text,
  ADD COLUMN IF NOT EXISTS main_employee_name text;
COMMENT ON COLUMN public.handover_events.main_employee_ref IS
  'Main / Responsible Employee reference: auth user uuid as text, or "emp:<id>" for a Settings → Employees member without a login. Migration 050.';
COMMIT;
