-- ─────────────────────────────────────────────────────────────────────────────
-- 013_record_stock_movement.sql — atomic, transactional stock movement engine
--
-- ONE function = ONE transaction. Guarantees:
--   • Row lock (FOR UPDATE) serializes concurrent movements on the same item
--   • Negative stock blocked (RAISE EXCEPTION) — factory-safe
--   • items.stock + status + trend updated
--   • Immutable stock_movements row inserted
--   • Legacy item_history row inserted (keeps existing History UI in sync)
--   • All-or-nothing — any failure rolls back the whole thing
--
-- p_qty is the SIGNED delta (+in / −out). The caller decides sign by movement type.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.record_stock_movement(
  p_item_code      text,
  p_movement_type  text,
  p_qty            numeric,
  p_reference_type text DEFAULT NULL,
  p_reference_id   text DEFAULT NULL,
  p_notes          text DEFAULT NULL,
  p_user_id        uuid DEFAULT NULL,
  p_user_name      text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_item      public.items%ROWTYPE;
  v_before    numeric;
  v_after     numeric;
  v_min       numeric;
  v_status    text;
  v_trend     jsonb;
BEGIN
  -- Validate movement type
  IF p_movement_type NOT IN (
    'purchase_in','production_issue','production_output',
    'manual_adjustment','sales_out','return_in','return_out'
  ) THEN
    RAISE EXCEPTION 'Invalid movement_type: %', p_movement_type USING ERRCODE = 'check_violation';
  END IF;

  IF p_qty IS NULL OR p_qty = 0 THEN
    RAISE EXCEPTION 'Movement qty must be a non-zero number' USING ERRCODE = 'check_violation';
  END IF;

  -- Lock the item row — serializes concurrent movements, prevents lost updates
  SELECT * INTO v_item FROM public.items WHERE code = p_item_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found: %', p_item_code USING ERRCODE = 'no_data_found';
  END IF;

  v_before := COALESCE(v_item.stock, 0);
  v_after  := v_before + p_qty;
  v_min    := COALESCE(v_item.min_stock, 0);

  -- BLOCK NEGATIVE STOCK (factory-safe)
  IF v_after < 0 THEN
    RAISE EXCEPTION 'Insufficient stock for % — on hand %, requested change %, would result in %',
      p_item_code, v_before, p_qty, v_after USING ERRCODE = 'check_violation';
  END IF;

  -- Recompute status (mirror of client recomputeStatus: stock <= min rule)
  v_status := CASE
    WHEN v_after <= 0 THEN 'critical'
    WHEN v_after <= v_min AND v_after / GREATEST(1, v_min) < 0.15 THEN 'critical'
    WHEN v_after <= v_min THEN 'warning'
    ELSE 'safe'
  END;

  -- Trend: append new value, keep last 5 points
  v_trend := COALESCE(v_item.trend, '[]'::jsonb) || jsonb_build_array(v_after);
  IF jsonb_array_length(v_trend) > 5 THEN
    v_trend := (
      SELECT jsonb_agg(val ORDER BY ord)
      FROM jsonb_array_elements(v_trend) WITH ORDINALITY AS t(val, ord)
      WHERE ord > jsonb_array_length(v_trend) - 5
    );
  END IF;

  -- 1) Update item physical stock + status + trend (updated_at handled by trigger)
  UPDATE public.items
     SET stock = v_after, status = v_status, trend = v_trend
   WHERE id = v_item.id;

  -- 2) Immutable stock_movements ledger row
  INSERT INTO public.stock_movements
    (item_id, item_code, item_name, movement_type, qty, before_stock, after_stock,
     reference_type, reference_id, notes, created_by, created_by_name)
  VALUES
    (v_item.id, v_item.code, v_item.name, p_movement_type, p_qty, v_before, v_after,
     p_reference_type, p_reference_id, p_notes, p_user_id, p_user_name);

  -- 3) Legacy item_history (keeps the existing History UI / drawer populated, atomically)
  INSERT INTO public.item_history
    (item_id, item_code, item_name, category, event_type, quantity_change,
     stock_before, stock_after, reference_number, notes, created_by, created_by_name)
  VALUES
    (v_item.id, v_item.code, v_item.name, v_item.category, p_movement_type, p_qty,
     v_before, v_after, p_reference_id, p_notes, p_user_id, p_user_name);

  RETURN jsonb_build_object(
    'success',         true,
    'item_code',       v_item.code,
    'movement_type',   p_movement_type,
    'before_stock',    v_before,
    'after_stock',     v_after,
    'status',          v_status,
    'reserved_stock',  COALESCE(v_item.reserved_stock, 0),
    'available_stock', v_after - COALESCE(v_item.reserved_stock, 0)
  );
END
$fn$;

-- Allow authenticated users to call it (RLS on underlying tables + SECURITY DEFINER
-- means the function runs with the needed privileges, but the caller still needs EXECUTE).
GRANT EXECUTE ON FUNCTION public.record_stock_movement(text, text, numeric, text, text, text, uuid, text) TO authenticated;

COMMENT ON FUNCTION public.record_stock_movement IS
  'Atomic stock engine: locks item, blocks negative stock, updates stock+status+trend, writes immutable stock_movements + item_history. One transaction.';
