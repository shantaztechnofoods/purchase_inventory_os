-- ─────────────────────────────────────────────────────────────────────────────
-- 001_schema.sql — Identity (roles, users) and extensions
-- Run order: FIRST. Depends on: nothing.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pgcrypto;     -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;       -- case-insensitive usernames

-- ── ROLES ───────────────────────────────────────────────────────────────────
-- Mirrors the existing ROLE_CONFIG / authStore.DEFAULT_ROLES structure.
-- "actions" JSON shape:
--   { module: { action: boolean, ... }, ... }
--   e.g. { inventory: { add: true, edit: false, ... }, ... }
-- "pages" is an array of page slugs the role can view.
CREATE TABLE public.roles (
  key         text         PRIMARY KEY,        -- "Admin", "Purchase Manager", "super_admin"
  label       text         NOT NULL,
  icon        text,
  color       text,
  badge       text,
  pages       jsonb        NOT NULL DEFAULT '[]'::jsonb,
  actions     jsonb        NOT NULL DEFAULT '{}'::jsonb,
  is_system   boolean      NOT NULL DEFAULT false,   -- super_admin = true; blocks deletion
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.roles IS 'Permission roles. super_admin row is_system=true and cannot be deleted.';
COMMENT ON COLUMN public.roles.actions IS 'JSON: { module: { action: bool } }. Mirrors canDo() matrix.';
COMMENT ON COLUMN public.roles.pages   IS 'JSON array of allowed page slugs.';

-- ── USERS ───────────────────────────────────────────────────────────────────
-- 1:1 with auth.users via id (UUID). Profile + role data lives here.
-- Login is username-based: the app synthesizes "{username}@erp.shantaz.internal"
-- for Supabase Auth, but the user only sees the username field.
CREATE TABLE public.users (
  id           uuid         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username     citext       NOT NULL UNIQUE,
  full_name    text         NOT NULL,
  mobile       text,
  role_key     text         NOT NULL REFERENCES public.roles(key) ON DELETE RESTRICT,
  status       text         NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  overrides    jsonb,                            -- per-user permission overrides on top of role
  last_login   timestamptz,
  created_at   timestamptz  NOT NULL DEFAULT now(),
  updated_at   timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX users_role_key_idx ON public.users(role_key);
CREATE INDEX users_status_idx   ON public.users(status);

COMMENT ON TABLE  public.users IS 'App-level user profile. Joined 1:1 with auth.users via id.';
COMMENT ON COLUMN public.users.username IS 'Login name (case-insensitive). Synthesized to {username}@erp.shantaz.internal for Supabase Auth.';
COMMENT ON COLUMN public.users.overrides IS 'Optional JSON: { actions: { module: { action: bool } }, pages: { slug: bool } }. Overrides role permissions per-user.';

-- ── updated_at triggers ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER roles_updated_at BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER users_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
