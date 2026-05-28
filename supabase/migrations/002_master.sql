-- ─────────────────────────────────────────────────────────────────────────────
-- 002_master.sql — Master data: vendors, items, BOMs, settings
-- Run order: AFTER 001. Depends on: public.users.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── VENDORS ─────────────────────────────────────────────────────────────────
CREATE TABLE public.vendors (
  id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text         NOT NULL,
  category        text,                              -- "Mechanical","Electrical",...
  contact_person  text,
  phone           text,
  email           text,
  gst             text,
  address         text,
  city            text,
  notes           text,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX vendors_name_idx     ON public.vendors(name);
CREATE INDEX vendors_category_idx ON public.vendors(category);

-- ── ITEMS ───────────────────────────────────────────────────────────────────
-- Status (safe/warning/critical) is intentionally stored, not computed,
-- so reads don't need to re-evaluate the boundary rule on every query.
-- Application writes status using the canonical recomputeStatus(stock, min)
-- whenever stock changes.
CREATE TABLE public.items (
  id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  code                text         NOT NULL UNIQUE,
  name                text         NOT NULL,
  category            text         NOT NULL,
  unit                text,
  stock               numeric      NOT NULL DEFAULT 0,
  min_stock           numeric      NOT NULL DEFAULT 0,
  max_stock           numeric,
  status              text         CHECK (status IN ('safe','warning','critical')),
  location            text,
  last_purchase_rate  numeric,
  vendor_links        jsonb        DEFAULT '[]'::jsonb,    -- [{vendorId, role}]
  trend               jsonb        DEFAULT '[]'::jsonb,    -- last N stock points
  created_at          timestamptz  NOT NULL DEFAULT now(),
  updated_at          timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX items_category_idx ON public.items(category);
CREATE INDEX items_status_idx   ON public.items(status);
CREATE INDEX items_code_idx     ON public.items(code);

-- ── ITEM HISTORY ────────────────────────────────────────────────────────────
-- Split from items so the row stays small and history grows freely.
CREATE TABLE public.item_history (
  id          bigserial    PRIMARY KEY,
  item_id     uuid         NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  item_code   text         NOT NULL,                        -- denormalized for fast filter
  event_date  date         NOT NULL,
  event       text         NOT NULL,                        -- "Restock","Usage","PO: PO-12",...
  change      numeric      NOT NULL,
  qty_after   numeric      NOT NULL,
  created_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX item_history_item_idx ON public.item_history(item_id, created_at DESC);
CREATE INDEX item_history_code_idx ON public.item_history(item_code);

-- ── BOM DEFINITIONS ─────────────────────────────────────────────────────────
-- key is human-friendly (e.g. "KM-10"). Matches existing ERP usage.
CREATE TABLE public.bom_definitions (
  key            text         PRIMARY KEY,
  label          text         NOT NULL,
  color          text,
  rack_capacity  integer      DEFAULT 0 CHECK (rack_capacity >= 0),
  items          jsonb        NOT NULL DEFAULT '[]'::jsonb,    -- [{ code, qty }]
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  updated_by     uuid         REFERENCES public.users(id) ON DELETE SET NULL
);
COMMENT ON COLUMN public.bom_definitions.items IS 'Array of {code, qty}. References public.items by code.';

-- ── SETTINGS (singleton) ────────────────────────────────────────────────────
-- One row per setting key. The app today writes one bundle to key='org'.
CREATE TABLE public.settings (
  key         text         PRIMARY KEY,
  value       jsonb        NOT NULL,
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  updated_by  uuid         REFERENCES public.users(id) ON DELETE SET NULL
);

-- ── updated_at triggers ─────────────────────────────────────────────────────
CREATE TRIGGER vendors_updated_at         BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER items_updated_at           BEFORE UPDATE ON public.items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER bom_definitions_updated_at BEFORE UPDATE ON public.bom_definitions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER settings_updated_at        BEFORE UPDATE ON public.settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
