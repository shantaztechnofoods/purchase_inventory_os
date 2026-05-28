// Realtime subscriptions for 5 critical tables.
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

    ch.subscribe((status) => {
      if (status === "SUBSCRIBED")   console.info(`[realtime] subscribed to ${wired.length} tables:`, wired.join(", "));
      if (status === "CHANNEL_ERROR") console.error("[realtime] channel error");
    });

    return () => { try { c.removeChannel(ch); } catch {} };
  }, [onItemsChange, onMovementsChange, onPosChange, onInwardChange, onOutwardChange, onAuditChange, onMachinesChange, onPendingChange]);
}
