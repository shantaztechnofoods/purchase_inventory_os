-- ─────────────────────────────────────────────────────────────────────────────
-- 051_admin_cleanup.sql — Admin Data Cleanup (test machines + linked records)
--
-- One SECURITY DEFINER function, two modes:
--   admin_cleanup_machines(p_keep_ids bigint[], p_execute boolean, p_expected_ids bigint[])
--   p_expected_ids (execute only): the ids the admin saw in the preview. If the
--   set to delete differs (a machine was created meanwhile), nothing is deleted.
--   • preview (p_execute = false): counts of what WOULD be deleted, per table,
--     plus the list of machines. Reads only.
--   • execute (p_execute = true): deletes, inside the function's single
--     transaction, every machine NOT in p_keep_ids and its linked records:
--     handover_events, pending_handover_items, checklist_responses,
--     department_ratings, machine_attachments (FK CASCADE), and the
--     outward_log rows of those machines' serials. Any error rolls the whole
--     thing back. audit_log is never touched (immutable by design); one audit
--     row records who ran it, when, and exactly what was deleted (ids, serials,
--     per-table counts).
-- Only a super_admin or a user with machines.configDept may call it. Master
-- data (items, stock, bom_definitions, users, settings, vendors, POs) is never
-- touched. Rollback: 051_admin_cleanup_rollback.sql
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_cleanup_machines(p_keep_ids bigint[], p_execute boolean DEFAULT false, p_expected_ids bigint[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_user       record;
  v_machines   jsonb;
  v_counts     jsonb;
  v_serials    text[];
  v_ids        bigint[];
  n_m int; n_h int; n_p int; n_c int; n_r int; n_a int; n_o int;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  SELECT id, username, full_name, role_key, status INTO v_user FROM public.users WHERE id = v_uid;
  IF v_user.id IS NULL OR v_user.status IS DISTINCT FROM 'active' THEN RAISE EXCEPTION 'User not active' USING ERRCODE = '42501'; END IF;
  IF NOT (v_user.role_key = 'super_admin' OR public.has_permission('machines', 'configDept')) THEN
    RAISE EXCEPTION 'Admin permission required for data cleanup' USING ERRCODE = '42501';
  END IF;

  p_keep_ids := coalesce(p_keep_ids, '{}');
  SELECT array_agg(id), array_agg(serial_no) FILTER (WHERE serial_no IS NOT NULL AND serial_no <> '')
    INTO v_ids, v_serials
    FROM public.machine_log WHERE NOT (id = ANY(p_keep_ids));
  v_ids := coalesce(v_ids, '{}'); v_serials := coalesce(v_serials, '{}');

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'serial', serial_no, 'bom', bom_key, 'stage', stage, 'status', status, 'slot', rack_slot) ORDER BY id), '[]'::jsonb)
    INTO v_machines FROM public.machine_log WHERE id = ANY(v_ids);

  SELECT count(*) INTO n_m FROM public.machine_log WHERE id = ANY(v_ids);
  SELECT count(*) INTO n_h FROM public.handover_events WHERE machine_id = ANY(v_ids);
  SELECT count(*) INTO n_p FROM public.pending_handover_items WHERE machine_id = ANY(v_ids);
  SELECT count(*) INTO n_c FROM public.checklist_responses WHERE machine_id = ANY(v_ids);
  SELECT count(*) INTO n_r FROM public.department_ratings WHERE machine_id = ANY(v_ids);
  SELECT count(*) INTO n_a FROM public.machine_attachments WHERE machine_id = ANY(v_ids);
  SELECT count(*) INTO n_o FROM public.outward_log WHERE serial_no = ANY(v_serials);
  v_counts := jsonb_build_object('machine_log', n_m, 'handover_events', n_h, 'pending_handover_items', n_p,
                                 'checklist_responses', n_c, 'department_ratings', n_r, 'machine_attachments', n_a, 'outward_log', n_o);

  IF NOT p_execute THEN
    RETURN jsonb_build_object('mode', 'preview', 'keep_ids', to_jsonb(p_keep_ids), 'machines', v_machines, 'counts', v_counts);
  END IF;

  -- Execute: the function body is one transaction; any failure rolls back all of it.
  IF p_expected_ids IS NULL THEN
    RAISE EXCEPTION 'Preview required before cleanup' USING ERRCODE = '22023';
  END IF;
  IF NOT (v_ids <@ p_expected_ids AND p_expected_ids <@ v_ids) THEN
    RAISE EXCEPTION 'Machine list changed since the preview — run the preview again' USING ERRCODE = '40001';
  END IF;
  DELETE FROM public.outward_log WHERE serial_no = ANY(v_serials);
  DELETE FROM public.machine_log WHERE id = ANY(v_ids);   -- cascades the linked tables

  INSERT INTO public.audit_log (user_id, user_name, user_role, type, module, action, details)
  VALUES (v_uid, coalesce(v_user.full_name, v_user.username, 'Admin'), v_user.role_key, 'admin_cleanup', 'Machine',
          format('Admin data cleanup: %s machine(s) and linked records deleted; %s kept', n_m, coalesce(array_length(p_keep_ids, 1), 0)),
          jsonb_build_object('keep_ids', to_jsonb(p_keep_ids), 'deleted_machines', v_machines, 'counts', v_counts));

  RETURN jsonb_build_object('mode', 'executed', 'keep_ids', to_jsonb(p_keep_ids), 'machines', v_machines, 'counts', v_counts);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cleanup_machines(bigint[], boolean, bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_cleanup_machines(bigint[], boolean, bigint[]) TO authenticated;

COMMIT;
