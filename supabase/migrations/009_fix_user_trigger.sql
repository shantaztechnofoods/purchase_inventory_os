-- ─────────────────────────────────────────────────────────────────────────────
-- 009_fix_user_trigger.sql — make handle_new_auth_user bulletproof
--
-- Uses NAMED dollar quotes ($func$...$func$) to survive copy-paste through any
-- editor or chat client that may strip duplicate $ characters.
--
-- The previous trigger from 007_seed.sql failed when:
--   1. Username derived from email's local part collided with an existing user
--      → UNIQUE violation → "Database error creating new user"
--   2. role_key 'Admin' missing → FK violation → same error
--   3. Email shape unusual → trigger threw → same error
--
-- Any of these would roll back the auth.users INSERT, blocking admin-create-user.
-- This trigger:
--   • generates a unique username (appends random suffix on collision, up to 5 tries)
--   • falls back through role candidates (Admin → first non-system role → super_admin)
--   • wraps INSERT in EXCEPTION block so trigger NEVER fails the parent transaction
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $func$
DECLARE
  v_base_username  text;
  v_username       text;
  v_role           text;
  v_attempt        int := 0;
  v_max_attempts   int := 5;
BEGIN
  -- Derive base username (defensive against null/empty email)
  v_base_username := COALESCE(
    NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
    'user_' || substring(NEW.id::text, 1, 8)
  );
  v_username := v_base_username;

  -- Ensure username uniqueness (loop up to 5 attempts, then fall through)
  WHILE EXISTS (SELECT 1 FROM public.users WHERE username = v_username) AND v_attempt < v_max_attempts LOOP
    v_attempt := v_attempt + 1;
    v_username := v_base_username || '_' || substring(md5(random()::text || NEW.id::text), 1, 4);
  END LOOP;

  -- After max attempts, force-uniquify with the UUID prefix
  IF EXISTS (SELECT 1 FROM public.users WHERE username = v_username) THEN
    v_username := v_base_username || '_' || substring(NEW.id::text, 1, 8);
  END IF;

  -- Determine role with fallback chain
  IF NEW.email = 'admin@erp.shantaz.internal' THEN
    v_role := 'super_admin';
  ELSE
    SELECT key INTO v_role FROM public.roles WHERE key = 'Admin' LIMIT 1;
    IF v_role IS NULL THEN
      SELECT key INTO v_role FROM public.roles WHERE COALESCE(is_system, false) = false ORDER BY key LIMIT 1;
    END IF;
    IF v_role IS NULL THEN
      v_role := 'super_admin';
    END IF;
  END IF;

  -- Insert profile. EXCEPTION handler ensures trigger never aborts auth user creation
  BEGIN
    INSERT INTO public.users (id, username, full_name, role_key, status)
    VALUES (
      NEW.id,
      v_username,
      COALESCE(NEW.raw_user_meta_data ->> 'full_name', v_username),
      v_role,
      'active'
    )
    ON CONFLICT (id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'handle_new_auth_user: profile insert failed for id=% email=% — % (SQLSTATE: %)',
                  NEW.id, NEW.email, SQLERRM, SQLSTATE;
  END;

  RETURN NEW;
END
$func$;

-- Re-bind the trigger to ensure it points at the new function body
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

COMMENT ON FUNCTION public.handle_new_auth_user() IS
  'Bulletproof auth.users to public.users sync. Handles username collisions, missing roles, null emails. Never aborts parent transaction.';
