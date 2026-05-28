-- ─────────────────────────────────────────────────────────────────────────────
-- 003_transactional.sql — POs, inward/outward/pending logs, follow-ups, machines
-- Run order: AFTER 002. Depends on: public.users, public.vendors.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── PURCHASE ORDERS ─────────────────────────────────────────────────────────
-- id is human-readable ("PO-001") to match existing ERP.
-- line_items JSON preserves the rich shape used today (code/name/qty/rate/amount/unit/category).
-- vendor (text) is denormalized for display performance; vendor_id is the FK.
CREATE TABLE public.purchase_orders (
  id              text         PRIMARY KEY,
  vendor          text         NOT NULL,
  vendor_id       uuid         REFERENCES public.vendors(id) ON DELETE SET NULL,
  status          text         NOT NULL CHECK (status IN
                                ('draft','review','pending','approved','rejected','ordered','overdue','received')),
  date            date,
  ordered_date    date,
  received_date   date,
  eta             text,
  priority        text         CHECK (priority IN ('low','normal','high','urgent') OR priority IS NULL),
  amount          numeric,
  gst             numeric,
  notes           text,
  reject_reason   text,
  line_items      jsonb        NOT NULL DEFAULT '[]'::jsonb,
  activity_log    jsonb        NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  created_by      uuid         REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX pos_status_idx     ON public.purchase_orders(status);
CREATE INDEX pos_vendor_idx     ON public.purchase_orders(vendor);
CREATE INDEX pos_date_idx       ON public.purchase_orders(date DESC);
CREATE INDEX pos_vendor_id_idx  ON public.purchase_orders(vendor_id);

-- ── INWARD LOG ──────────────────────────────────────────────────────────────
CREATE TABLE public.inward_log (
  id          bigserial    PRIMARY KEY,
  event_date  date         NOT NULL,
  vendor      text,
  item_code   text         NOT NULL,
  item_name   text         NOT NULL,
  unit        text,
  qty         numeric      NOT NULL,
  from_po     text         REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  notes       text,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  created_by  uuid         REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE INDEX inward_log_date_idx    ON public.inward_log(event_date DESC);
CREATE INDEX inward_log_from_po_idx ON public.inward_log(from_po);
CREATE INDEX inward_log_code_idx    ON public.inward_log(item_code);

-- ── OUTWARD LOG ─────────────────────────────────────────────────────────────
CREATE TABLE public.outward_log (
  id          bigserial    PRIMARY KEY,
  event_date  date         NOT NULL,
  type        text         NOT NULL CHECK (type IN ('bom','manual')),
  ref         text         NOT NULL,                       -- bom key or item code
  label       text,
  units       integer,                                     -- BOM units issued
  dept        text,
  serial_no   text,
  issue_id    bigint,                                      -- links to pending/machine rows
  items       jsonb        NOT NULL DEFAULT '[]'::jsonb,
  note        text,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  created_by  uuid         REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE INDEX outward_log_date_idx     ON public.outward_log(event_date DESC);
CREATE INDEX outward_log_ref_idx      ON public.outward_log(ref);
CREATE INDEX outward_log_issue_id_idx ON public.outward_log(issue_id);

-- ── PENDING LOG ─────────────────────────────────────────────────────────────
CREATE TABLE public.pending_log (
  id           bigserial    PRIMARY KEY,
  issue_id     bigint,
  bom_key      text,
  bom_label    text,
  code         text         NOT NULL,
  name         text,
  category     text,
  unit         text,
  pending_qty  numeric      NOT NULL,
  issue_qty    numeric      NOT NULL DEFAULT 0,
  serial_no    text,
  event_date   date,
  created_at   timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX pending_log_issue_idx ON public.pending_log(issue_id);
CREATE INDEX pending_log_code_idx  ON public.pending_log(code);

-- ── FOLLOW-UPS ──────────────────────────────────────────────────────────────
CREATE TABLE public.follow_ups (
  id              bigserial    PRIMARY KEY,
  po_id           text         REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  vendor          text,
  item_names      jsonb,
  eta             text,
  confirmed_date  date,
  next_follow_up  date,
  last_follow_up  date,
  frequency       integer,
  created_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX follow_ups_po_idx   ON public.follow_ups(po_id);
CREATE INDEX follow_ups_next_idx ON public.follow_ups(next_follow_up);

-- ── MACHINE LOG ─────────────────────────────────────────────────────────────
CREATE TABLE public.machine_log (
  id              bigserial    PRIMARY KEY,
  issue_id        bigint,                                  -- ties to outward_log + pending_log
  bom_key         text         NOT NULL,
  bom_label       text,
  serial_no       text,
  stage           text         NOT NULL CHECK (stage IN
                                ('BOM Issued','Assembly','Mechanical','Electrical','Trial','Ready')),
  status          text         NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  created_date    date,
  completed_date  date,
  history         jsonb        NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  created_by      uuid         REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at      timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX machine_log_bom_key_idx  ON public.machine_log(bom_key);
CREATE INDEX machine_log_stage_idx    ON public.machine_log(stage);
CREATE INDEX machine_log_status_idx   ON public.machine_log(status);
CREATE INDEX machine_log_issue_idx    ON public.machine_log(issue_id);

-- ── updated_at triggers ─────────────────────────────────────────────────────
CREATE TRIGGER pos_updated_at         BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER machine_log_updated_at BEFORE UPDATE ON public.machine_log
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
