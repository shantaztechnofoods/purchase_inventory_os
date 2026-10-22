-- ─────────────────────────────────────────────────────────────────────────────
-- 030_dept_roster_view.sql — Make the minimal employee roster visible to all
-- authenticated users so the Finish & Transfer worker picker (migration 029)
-- actually populates for non-super-admin roles.
-- Depends on: 001 (public.users), 029 (users.departments).
--
-- Background
-- ----------
-- public.users has a restrictive SELECT RLS policy that only lets a user see
-- their own row unless they have `users.view` or `is_super_admin()`. That's
-- fine for the User Management page, but it hides the roster from every
-- operator who opens Finish & Transfer, so the Workers / Main Employee
-- dropdowns are empty for Purchase Manager / Admin / any role without
-- users.view. We expose a narrow projection (id, username, full_name, status,
-- departments) via a SECURITY INVOKER = false view and GRANT SELECT to
-- authenticated. No sensitive columns (mobile, role_key, overrides,
-- last_login) are exposed through this view.
--
-- Strictly additive. No existing policy / column changed. No destructive op.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE VIEW public.v_dept_roster
  WITH (security_invoker = false) AS
SELECT
  u.id,
  u.username,
  u.full_name,
  u.status,
  u.departments
FROM public.users u
WHERE u.status = 'active';

-- Postgres views don't support RLS directly; `security_invoker = false`
-- (default) runs the underlying SELECT as the view owner (postgres),
-- effectively bypassing the restrictive users RLS. We only expose the five
-- columns above, no PII beyond what already appears in audit_log /
-- machine_log history / handover_events reads today.
GRANT SELECT ON public.v_dept_roster TO authenticated;

COMMIT;
