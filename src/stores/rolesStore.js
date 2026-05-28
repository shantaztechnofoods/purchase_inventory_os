// Roles store — public.roles CRUD.
// Reads already live in authStore.fetchAllRoles(); this file owns mutations.

import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

function toRow(key, r) {
  return {
    key,
    label:   r.label || key,
    icon:    r.icon  || null,
    color:   r.color || null,
    badge:   r.badge || null,
    pages:   r.pages   || [],
    actions: r.actions || {},
  };
}

export async function createRole(key, role) {
  console.info("[roles:create] start", { key, label: role.label });
  if (!isSupabaseEnabled()) { console.info("[roles:create] local-only no-op"); return { success: true }; }
  const c = getSupabase();
  if (!c) return { success: false, error: "Supabase not configured" };
  const { error } = await c.from("roles").insert(toRow(key, role));
  if (error) { console.error("[roles:create] failed", error); return { success: false, error: error.message }; }
  console.info("[roles:create] supabase ok");
  return { success: true };
}

export async function updateRole(key, role) {
  console.info("[roles:update] start", { key });
  if (!isSupabaseEnabled()) { return { success: true }; }
  const c = getSupabase();
  if (!c) return { success: false, error: "Supabase not configured" };
  const payload = toRow(key, role); delete payload.key;
  const { error } = await c.from("roles").update(payload).eq("key", key);
  if (error) { console.error("[roles:update] failed", error); return { success: false, error: error.message }; }
  console.info("[roles:update] supabase ok");
  return { success: true };
}

export async function deleteRole(key) {
  console.info("[roles:delete] start", { key });
  if (!isSupabaseEnabled()) { return { success: true }; }
  const c = getSupabase();
  if (!c) return { success: false, error: "Supabase not configured" };
  const { error } = await c.from("roles").delete().eq("key", key);
  if (error) { console.error("[roles:delete] failed", error); return { success: false, error: error.message }; }
  console.info("[roles:delete] supabase ok");
  return { success: true };
}
