-- ─────────────────────────────────────────────────────────────────────────────
-- 007_seed.sql — Default roles + super_admin profile row
-- Run order: LAST. Depends on: all prior migrations.
--
-- IMPORTANT — Super Admin auth user creation is a TWO-STEP process:
--   1. Run this file → creates the roles + sets up the trigger that auto-links
--      the public.users row when the auth user is created.
--   2. In Supabase Dashboard → Authentication → Add user → create:
--        email:    admin@erp.shantaz.internal
--        password: admin123       (CHANGE THIS IMMEDIATELY after first login)
--        Auto-confirm: ON
--      The trigger below auto-inserts the matching public.users row.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Default roles (mirrors authStore.DEFAULT_ROLES) ─────────────────────────
INSERT INTO public.roles (key, label, icon, color, badge, pages, actions, is_system) VALUES
('super_admin',
 'Super Admin', '🔑', '#ec4899', 'Unrestricted',
 '["dashboard","inventory","inward","outward","pending","pipeline","machines","vendors","analytics","ai","history","audit","settings","users","roles"]'::jsonb,
 '{}'::jsonb,
 true),
('Admin',
 'Admin', '👑', '#6366f1', 'Full Access',
 '["dashboard","inventory","inward","outward","pending","pipeline","machines","vendors","analytics","ai","history","audit","settings","users","roles"]'::jsonb,
 '{
   "inventory": {"add":true,"edit":true,"delete":true,"adjust":true},
   "pipeline":  {"create":true,"approve":true,"reject":true,"ordered":true,"receive":true,"delete":true},
   "outward":   {"bom":true,"manual":true,"editBOM":true},
   "machines":  {"updateStage":true},
   "vendors":   {"add":true,"edit":true,"delete":true},
   "inward":    {"submit":true},
   "pending":   {"fulfill":true,"clear":true},
   "users":     {"view":true,"create":true,"edit":true,"delete":true},
   "roles":     {"view":true,"create":true,"edit":true,"delete":true}
 }'::jsonb,
 false),
('Purchase Manager',
 'Purchase Manager', '🛒', '#3b82f6', 'Purchase',
 '["dashboard","inventory","inward","pipeline","vendors","history","analytics"]'::jsonb,
 '{
   "inventory": {"add":false,"edit":false,"delete":false,"adjust":false},
   "pipeline":  {"create":true,"approve":true,"reject":true,"ordered":true,"receive":true,"delete":false},
   "outward":   {"bom":false,"manual":false,"editBOM":false},
   "machines":  {"updateStage":false},
   "vendors":   {"add":false,"edit":false,"delete":false},
   "inward":    {"submit":true},
   "pending":   {"fulfill":false,"clear":false},
   "users":     {"view":false,"create":false,"edit":false,"delete":false},
   "roles":     {"view":false,"create":false,"edit":false,"delete":false}
 }'::jsonb,
 false),
('Store Manager',
 'Store Manager', '📦', '#22c55e', 'Store',
 '["dashboard","inventory","inward","outward","pending","machines","history"]'::jsonb,
 '{
   "inventory": {"add":false,"edit":false,"delete":false,"adjust":true},
   "pipeline":  {"create":false,"approve":false,"reject":false,"ordered":false,"receive":false,"delete":false},
   "outward":   {"bom":true,"manual":true,"editBOM":false},
   "machines":  {"updateStage":true},
   "vendors":   {"add":false,"edit":false,"delete":false},
   "inward":    {"submit":true},
   "pending":   {"fulfill":true,"clear":true},
   "users":     {"view":false,"create":false,"edit":false,"delete":false},
   "roles":     {"view":false,"create":false,"edit":false,"delete":false}
 }'::jsonb,
 false),
('Production',
 'Production', '🔧', '#f59e0b', 'Production',
 '["dashboard","inventory","outward","pending","machines","history"]'::jsonb,
 '{
   "inventory": {"add":false,"edit":false,"delete":false,"adjust":false},
   "pipeline":  {"create":false,"approve":false,"reject":false,"ordered":false,"receive":false,"delete":false},
   "outward":   {"bom":true,"manual":false,"editBOM":false},
   "machines":  {"updateStage":true},
   "vendors":   {"add":false,"edit":false,"delete":false},
   "inward":    {"submit":false},
   "pending":   {"fulfill":true,"clear":false},
   "users":     {"view":false,"create":false,"edit":false,"delete":false},
   "roles":     {"view":false,"create":false,"edit":false,"delete":false}
 }'::jsonb,
 false)
ON CONFLICT (key) DO NOTHING;

-- ── Auto-link trigger: when an auth user is created, insert a profile row ───
-- For the super_admin bootstrap, we look for the synthetic email
-- "admin@erp.shantaz.internal" and assign super_admin role.
-- For any other new auth user, default to a placeholder profile that the
-- admin must update via User Management (sets role and full_name).
CREATE OR REPLACE FUNCTION public.handle_new_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_username text;
  v_role     text;
BEGIN
  -- Derive username from "{username}@erp.shantaz.internal"
  v_username := split_part(NEW.email, '@', 1);

  IF NEW.email = 'admin@erp.shantaz.internal' THEN
    v_role := 'super_admin';
  ELSE
    -- New users default to 'Admin' role until super_admin reassigns.
    -- super_admin can change this immediately after creation.
    v_role := 'Admin';
  END IF;

  INSERT INTO public.users (id, username, full_name, role_key, status)
  VALUES (
    NEW.id,
    v_username,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', v_username),
    v_role,
    'active'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- ── Bootstrap settings row ──────────────────────────────────────────────────
INSERT INTO public.settings (key, value) VALUES
  ('org', '{
    "companyName": "Shantaz Technofoods",
    "currency": "INR (₹)",
    "whatsappAlerts": false,
    "emailAlerts": false
  }'::jsonb)
ON CONFLICT (key) DO NOTHING;
