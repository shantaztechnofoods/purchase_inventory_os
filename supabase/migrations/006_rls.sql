-- ─────────────────────────────────────────────────────────────────────────────
-- 006_rls.sql — Row-Level Security policies for every table
-- Run order: AFTER 005. Depends on: helper functions in 005.
--
-- Default posture: deny-all. Each policy below explicitly grants the access
-- mirroring the existing canDo()/canView() matrix.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Enable RLS on every table ───────────────────────────────────────────────
ALTER TABLE public.roles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.item_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bom_definitions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inward_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outward_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.machine_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log        ENABLE ROW LEVEL SECURITY;

-- ── ROLES ───────────────────────────────────────────────────────────────────
-- Everyone signed-in can READ roles (needed to render the role label in UI).
-- Only super_admin can CREATE/UPDATE/DELETE roles. is_system rows can never be deleted.
CREATE POLICY roles_select ON public.roles FOR SELECT
  USING (is_active_user());
CREATE POLICY roles_insert ON public.roles FOR INSERT
  WITH CHECK (is_super_admin());
CREATE POLICY roles_update ON public.roles FOR UPDATE
  USING (is_super_admin());
CREATE POLICY roles_delete ON public.roles FOR DELETE
  USING (is_super_admin() AND is_system = false);

-- ── USERS ───────────────────────────────────────────────────────────────────
-- Each user can SEE their own profile. Super_admin sees all.
-- Only super_admin can INSERT/DELETE (handled via admin Edge Function).
-- A user can UPDATE their own full_name / mobile only (enforced by Edge Function);
-- super_admin can update any column.
CREATE POLICY users_select ON public.users FOR SELECT
  USING (id = auth.uid() OR is_super_admin() OR has_permission('users','view'));
CREATE POLICY users_insert ON public.users FOR INSERT
  WITH CHECK (is_super_admin() OR has_permission('users','create'));
CREATE POLICY users_update ON public.users FOR UPDATE
  USING (is_super_admin() OR has_permission('users','edit') OR id = auth.uid());
CREATE POLICY users_delete ON public.users FOR DELETE
  USING (is_super_admin() OR has_permission('users','delete'));

-- ── VENDORS ─────────────────────────────────────────────────────────────────
CREATE POLICY vendors_select ON public.vendors FOR SELECT USING (is_active_user());
CREATE POLICY vendors_insert ON public.vendors FOR INSERT WITH CHECK (has_permission('vendors','add'));
CREATE POLICY vendors_update ON public.vendors FOR UPDATE USING (has_permission('vendors','edit'));
CREATE POLICY vendors_delete ON public.vendors FOR DELETE USING (has_permission('vendors','delete'));

-- ── ITEMS ───────────────────────────────────────────────────────────────────
-- UPDATE is split: stock changes (adjust) vs metadata changes (edit) both fall under UPDATE.
-- The canDo grid has both inventory.edit and inventory.adjust; either grants UPDATE.
CREATE POLICY items_select ON public.items FOR SELECT USING (is_active_user());
CREATE POLICY items_insert ON public.items FOR INSERT WITH CHECK (has_permission('inventory','add'));
CREATE POLICY items_update ON public.items FOR UPDATE USING (has_permission('inventory','edit') OR has_permission('inventory','adjust'));
CREATE POLICY items_delete ON public.items FOR DELETE USING (has_permission('inventory','delete'));

-- ── ITEM HISTORY ────────────────────────────────────────────────────────────
-- Read-only for users. Inserts performed by triggers/handlers that already
-- passed inventory permission checks; we allow INSERT from any authenticated user.
CREATE POLICY item_history_select ON public.item_history FOR SELECT USING (is_active_user());
CREATE POLICY item_history_insert ON public.item_history FOR INSERT WITH CHECK (is_active_user());
-- No UPDATE/DELETE policies on item_history — historical record stays intact.

-- ── BOM DEFINITIONS ─────────────────────────────────────────────────────────
CREATE POLICY bom_select ON public.bom_definitions FOR SELECT USING (is_active_user());
CREATE POLICY bom_insert ON public.bom_definitions FOR INSERT WITH CHECK (has_permission('outward','editBOM'));
CREATE POLICY bom_update ON public.bom_definitions FOR UPDATE USING (has_permission('outward','editBOM'));
CREATE POLICY bom_delete ON public.bom_definitions FOR DELETE USING (is_super_admin());

-- ── SETTINGS ────────────────────────────────────────────────────────────────
CREATE POLICY settings_select ON public.settings FOR SELECT USING (is_active_user());
CREATE POLICY settings_upsert ON public.settings FOR INSERT WITH CHECK (is_super_admin());
CREATE POLICY settings_update ON public.settings FOR UPDATE USING (is_super_admin());

-- ── PURCHASE ORDERS ─────────────────────────────────────────────────────────
-- UPDATE covers approve/reject/order/receive transitions. The app already
-- gates the buttons per action; DB-level we accept any user with 'create' or
-- one of the lifecycle actions.
CREATE POLICY pos_select ON public.purchase_orders FOR SELECT USING (is_active_user());
CREATE POLICY pos_insert ON public.purchase_orders FOR INSERT WITH CHECK (has_permission('pipeline','create'));
CREATE POLICY pos_update ON public.purchase_orders FOR UPDATE USING (
  has_permission('pipeline','approve')
  OR has_permission('pipeline','reject')
  OR has_permission('pipeline','ordered')
  OR has_permission('pipeline','receive')
  OR has_permission('pipeline','create')
);
-- Only super_admin can delete a PO outright (the client also offers Reverse
-- Receive for received POs — that's an UPDATE, covered above).
CREATE POLICY pos_delete ON public.purchase_orders FOR DELETE USING (
  is_super_admin() OR has_permission('pipeline','delete')
);

-- ── INWARD LOG ──────────────────────────────────────────────────────────────
CREATE POLICY inward_select ON public.inward_log FOR SELECT USING (is_active_user());
CREATE POLICY inward_insert ON public.inward_log FOR INSERT WITH CHECK (
  has_permission('inward','submit') OR has_permission('pipeline','receive')
);
-- No UPDATE/DELETE on inward_log — historical record (matches client behavior).

-- ── OUTWARD LOG ─────────────────────────────────────────────────────────────
CREATE POLICY outward_select ON public.outward_log FOR SELECT USING (is_active_user());
CREATE POLICY outward_insert ON public.outward_log FOR INSERT WITH CHECK (
  has_permission('outward','bom') OR has_permission('outward','manual')
);

-- ── PENDING LOG ─────────────────────────────────────────────────────────────
CREATE POLICY pending_select ON public.pending_log FOR SELECT USING (is_active_user());
CREATE POLICY pending_insert ON public.pending_log FOR INSERT WITH CHECK (
  has_permission('outward','bom') OR has_permission('pending','fulfill')
);
CREATE POLICY pending_update ON public.pending_log FOR UPDATE USING (
  has_permission('pending','fulfill') OR has_permission('pending','clear')
);
CREATE POLICY pending_delete ON public.pending_log FOR DELETE USING (
  has_permission('pending','clear') OR has_permission('pending','fulfill')
);

-- ── FOLLOW UPS ──────────────────────────────────────────────────────────────
CREATE POLICY fu_select ON public.follow_ups FOR SELECT USING (is_active_user());
CREATE POLICY fu_insert ON public.follow_ups FOR INSERT WITH CHECK (has_permission('pipeline','ordered'));
CREATE POLICY fu_update ON public.follow_ups FOR UPDATE USING (has_permission('pipeline','ordered'));
CREATE POLICY fu_delete ON public.follow_ups FOR DELETE USING (
  has_permission('pipeline','receive') OR has_permission('pipeline','delete')
);

-- ── MACHINE LOG ─────────────────────────────────────────────────────────────
CREATE POLICY machine_select ON public.machine_log FOR SELECT USING (is_active_user());
CREATE POLICY machine_insert ON public.machine_log FOR INSERT WITH CHECK (
  has_permission('outward','bom') OR has_permission('machines','updateStage')
);
CREATE POLICY machine_update ON public.machine_log FOR UPDATE USING (has_permission('machines','updateStage'));
-- No DELETE on machine_log — completed machines are part of production record.

-- ── AUDIT LOG ───────────────────────────────────────────────────────────────
-- INSERT: any active user (matches client today — every user writes audits for their own actions).
-- SELECT: any active user (audit history is org-wide visible).
-- UPDATE/DELETE: deliberately no policies → rejected by RLS. Triggers in 004 add a hard stop.
CREATE POLICY audit_select ON public.audit_log FOR SELECT USING (is_active_user());
CREATE POLICY audit_insert ON public.audit_log FOR INSERT WITH CHECK (is_active_user());
