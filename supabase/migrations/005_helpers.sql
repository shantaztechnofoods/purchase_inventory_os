-- ─────────────────────────────────────────────────────────────────────────────
-- 005_helpers.sql — Permission helper functions used by RLS policies
-- Run order: AFTER 004. Depends on: public.users, public.roles.
-- ─────────────────────────────────────────────────────────────────────────────

-- is_super_admin(): true if the current JWT belongs to a super_admin user.
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = auth.uid()
       AND role_key = 'super_admin'
       AND status = 'active'
  );
$$;

-- is_active_user(): true if there is an active profile for the caller.
-- Used as the baseline "can this caller do anything at all?" check.
CREATE OR REPLACE FUNCTION public.is_active_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
     WHERE id = auth.uid()
       AND status = 'active'
  );
$$;

-- has_permission(module, action): mirrors the client-side canDo() matrix.
-- Resolution order:
--   1. super_admin → always true
--   2. user-level override (users.overrides.actions[module][action])
--   3. role permission (roles.actions[module][action])
--   4. default false
CREATE OR REPLACE FUNCTION public.has_permission(p_module text, p_action text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role_key  text;
  v_status    text;
  v_overrides jsonb;
  v_override  boolean;
  v_perm      boolean;
BEGIN
  SELECT role_key, status, overrides
    INTO v_role_key, v_status, v_overrides
    FROM public.users
   WHERE id = auth.uid();

  IF v_role_key IS NULL OR v_status <> 'active' THEN
    RETURN false;
  END IF;

  IF v_role_key = 'super_admin' THEN
    RETURN true;
  END IF;

  -- Per-user override beats role
  BEGIN
    v_override := (v_overrides -> 'actions' -> p_module ->> p_action)::boolean;
  EXCEPTION WHEN others THEN
    v_override := NULL;
  END;
  IF v_override IS NOT NULL THEN
    RETURN v_override;
  END IF;

  -- Role permission
  SELECT (actions -> p_module ->> p_action)::boolean
    INTO v_perm
    FROM public.roles
   WHERE key = v_role_key;

  RETURN COALESCE(v_perm, false);
END $$;

-- can_view_page(slug): mirrors client-side canView().
CREATE OR REPLACE FUNCTION public.can_view_page(p_page text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role_key  text;
  v_status    text;
  v_overrides jsonb;
  v_override  boolean;
  v_pages     jsonb;
BEGIN
  SELECT role_key, status, overrides
    INTO v_role_key, v_status, v_overrides
    FROM public.users
   WHERE id = auth.uid();

  IF v_role_key IS NULL OR v_status <> 'active' THEN RETURN false; END IF;
  IF v_role_key = 'super_admin' THEN RETURN true; END IF;

  BEGIN
    v_override := (v_overrides -> 'pages' ->> p_page)::boolean;
  EXCEPTION WHEN others THEN v_override := NULL;
  END;
  IF v_override IS NOT NULL THEN RETURN v_override; END IF;

  SELECT pages INTO v_pages FROM public.roles WHERE key = v_role_key;
  RETURN COALESCE(v_pages ? p_page, false);
END $$;
