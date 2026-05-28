-- ─────────────────────────────────────────────────────────────────────────────
-- 004_audit.sql — Append-only audit trail with immutability enforcement
-- Run order: AFTER 001. Depends on: public.users (FK is nullable so an
-- audit row survives user deletion).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.audit_log (
  id           bigserial    PRIMARY KEY,
  ts           timestamptz  NOT NULL DEFAULT now(),
  user_id      uuid         REFERENCES public.users(id) ON DELETE SET NULL,
  user_name    text         NOT NULL DEFAULT 'System',     -- denormalized for survival
  user_role    text,
  type         text         NOT NULL,                       -- 'login','po_created',...
  module       text         NOT NULL,                       -- 'Auth','Purchase','Inventory',...
  action       text         NOT NULL,                       -- human-readable description
  ref          text,
  vendor       text,
  item_code    text,
  item_name    text,
  serial_no    text,
  qty          numeric,
  amount       numeric,
  old_value    jsonb,
  new_value    jsonb,
  details      jsonb,
  ip_address   inet                                          -- optionally captured by Edge Function
);

CREATE INDEX audit_log_ts_idx     ON public.audit_log(ts DESC);
CREATE INDEX audit_log_user_idx   ON public.audit_log(user_id);
CREATE INDEX audit_log_module_idx ON public.audit_log(module);
CREATE INDEX audit_log_type_idx   ON public.audit_log(type);
CREATE INDEX audit_log_ref_idx    ON public.audit_log(ref);

-- ── IMMUTABILITY ENFORCEMENT ────────────────────────────────────────────────
-- The audit log must never be edited or deleted from the application.
-- RLS denies UPDATE/DELETE for client roles. These triggers add a hard stop
-- even if RLS were bypassed (e.g. by direct service_role mistake).
CREATE OR REPLACE FUNCTION public.reject_audit_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is immutable: % is not allowed', TG_OP
    USING ERRCODE = 'check_violation';
END $$;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.reject_audit_change();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION public.reject_audit_change();

COMMENT ON TABLE public.audit_log IS
  'Append-only. RLS rejects UPDATE/DELETE; triggers block them as defense in depth.';
