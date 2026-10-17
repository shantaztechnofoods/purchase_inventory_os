-- ─────────────────────────────────────────────────────────────────────────────
-- 023_pending_handover_items.sql — Phase B: previous-department pending work
-- Depends on: 021 (handover_events).
-- Pending items are raised during Accept; they carry forward in the receiving
-- department's checklist until explicitly resolved.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE TABLE IF NOT EXISTS public.pending_handover_items (
  id                     bigserial    PRIMARY KEY,
  machine_id             bigint       NOT NULL REFERENCES public.machine_log(id) ON DELETE CASCADE,
  raised_in_handover_id  bigint       REFERENCES public.handover_events(id) ON DELETE SET NULL,
  raised_in_department   text,        -- the dept that transferred OUT (sender)
  raised_by              uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  raised_at              timestamptz  NOT NULL DEFAULT now(),
  description            text         NOT NULL CHECK (length(trim(description)) > 0),

  -- Resolution
  resolved_at            timestamptz,
  resolved_by            uuid         REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_in_department text,
  resolution_notes       text,

  status                 text         NOT NULL DEFAULT 'open'
                                      CHECK (status IN ('open','resolved')),

  CONSTRAINT pending_item_resolve_pair CHECK (
    (status = 'resolved' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
     OR
    (status = 'open'     AND resolved_at IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS pending_handover_items_machine_idx
  ON public.pending_handover_items (machine_id, status);
CREATE INDEX IF NOT EXISTS pending_handover_items_open_idx
  ON public.pending_handover_items (machine_id)
  WHERE status = 'open';

ALTER TABLE public.pending_handover_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pending_handover_items_select ON public.pending_handover_items;
CREATE POLICY pending_handover_items_select ON public.pending_handover_items
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS pending_handover_items_insert ON public.pending_handover_items;
CREATE POLICY pending_handover_items_insert ON public.pending_handover_items
  FOR INSERT TO authenticated
  WITH CHECK (raised_by = auth.uid()
              AND public.has_permission('machines','accept'));

-- Only the resolver can mark as resolved; must still have finishTransfer
-- permission (the resolution is logged against them).
DROP POLICY IF EXISTS pending_handover_items_resolve ON public.pending_handover_items;
CREATE POLICY pending_handover_items_resolve ON public.pending_handover_items
  FOR UPDATE TO authenticated
  USING (status = 'open')
  WITH CHECK (
    status = 'resolved'
    AND resolved_by = auth.uid()
    AND public.has_permission('machines','finishTransfer')
  );

COMMIT;
