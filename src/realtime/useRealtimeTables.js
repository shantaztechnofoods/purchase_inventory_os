// Realtime subscriptions for the tables the UI must never show stale.
// Each handler receives the postgres_changes payload and triggers a re-fetch via the
// store callbacks passed in. Keep payload-handling simple: refetch on any change is
// safer than per-row diffing and keeps the React state authoritative.
//
// Usage in App.jsx:
//   useRealtimeTables({
//     onItemsChange: () => fetchItems().then(setItems),
//     onPosChange:   () => fetchPOs().then(setPos),
//     ...
//   });

import { useEffect } from "react";
import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

export function useRealtimeTables({
  onItemsChange,
  onMovementsChange,
  onPosChange,
  onInwardChange,
  onOutwardChange,
  onAuditChange,
  onMachinesChange,
  onPendingChange,
  onHandoversChange,
} = {}) {
  useEffect(() => {
    if (!isSupabaseEnabled()) return;
    const c = getSupabase();
    if (!c) return;

    const ch = c.channel("erp-realtime");
    const wired = [];
    const wire = (table, cb) => {
      if (!cb) return;
      wired.push(table);
      ch.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
        console.info(`[realtime:${table}]`, payload.eventType, payload.new?.id || payload.old?.id);
        try { cb(payload); } catch (e) { console.error(`[realtime:${table}] handler threw`, e); }
      });
    };
    // The 5 inventory-critical tables (per spec) + machine/pending for live workflow sync.
    wire("items",            onItemsChange);
    wire("stock_movements",  onMovementsChange);
    wire("purchase_orders",  onPosChange);
    wire("inward_log",       onInwardChange);
    wire("outward_log",      onOutwardChange);
    wire("audit_log",        onAuditChange);
    wire("machine_log",      onMachinesChange);
    wire("pending_log",      onPendingChange);
    // handover_events — the department-to-department baton.
    //
    // This was the one table in the workflow with no subscription, and the
    // omission was invisible on a desktop where people reload all day. On the
    // factory floor it is not: Assembly sends a machine on, and the tablet
    // standing in Mechanical goes on showing nothing at all until somebody
    // thinks to pull-to-refresh. The receiving department cannot accept work it
    // cannot see. Wiring it is the difference between a shared tablet being a
    // live queue and being a stale screenshot.
    wire("handover_events",  onHandoversChange);

    ch.subscribe((status) => {
      if (status === "SUBSCRIBED")   console.info(`[realtime] subscribed to ${wired.length} tables:`, wired.join(", "));
      if (status === "CHANNEL_ERROR") console.error("[realtime] channel error");
    });

    return () => { try { c.removeChannel(ch); } catch {} };
  }, [onItemsChange, onMovementsChange, onPosChange, onInwardChange, onOutwardChange, onAuditChange, onMachinesChange, onPendingChange, onHandoversChange]);
}
