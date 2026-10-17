// Employee signatures store — public.employee_signatures
//
// One signature per user (UNIQUE user_id, enforced in migration 021).
// RLS policies only allow self-SELECT and self-INSERT/UPDATE. Signatures are
// stored as serialized SVG text; see docs/department-workflow-phase-a.md §3.4.

import { isSupabaseEnabled, SUPABASE_URL, SUPABASE_ANON_KEY } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";
import { createClient } from "@supabase/supabase-js";

const LOCAL_KEY_PREFIX = "erp_signature_";  // keyed per user id in local mode

export async function getMySignature(userId) {
  if (!userId) return { success: false, error: "userId required" };
  if (!isSupabaseEnabled()) {
    try {
      const s = localStorage.getItem(LOCAL_KEY_PREFIX + userId);
      if (s) {
        const parsed = JSON.parse(s);
        return { success: true, signature: parsed };
      }
    } catch { /* fall through */ }
    return { success: true, signature: null };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  const { data, error } = await c
    .from("employee_signatures")
    .select("id, user_id, signature_svg, created_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[signatures:get] failed", error);
    return { success: false, error: error.message };
  }
  if (!data) return { success: true, signature: null };
  return { success: true, signature: fromRow(data) };
}

export async function saveMySignature(userId, signatureSvg) {
  if (!userId) return { success: false, error: "userId required" };
  if (!signatureSvg || !String(signatureSvg).trim()) return { success: false, error: "signature is empty" };
  if (!isSupabaseEnabled()) {
    const row = { id: Date.now(), userId, signatureSvg, createdAt: new Date().toISOString() };
    try { localStorage.setItem(LOCAL_KEY_PREFIX + userId, JSON.stringify(row)); } catch {}
    return { success: true, signature: row, replacement: false };
  }
  const c = getSupabase(); if (!c) return { success: false, error: "no client" };
  // Try UPDATE first (replacement path); if nothing updated, INSERT.
  const { data: upd, error: updErr } = await c
    .from("employee_signatures")
    .update({ signature_svg: signatureSvg })
    .eq("user_id", userId)
    .select()
    .maybeSingle();
  if (updErr) {
    console.error("[signatures:update] failed", updErr);
    return { success: false, error: updErr.message };
  }
  if (upd) return { success: true, signature: fromRow(upd), replacement: true };

  // No row yet — insert first-time.
  const { data: ins, error: insErr } = await c
    .from("employee_signatures")
    .insert({ user_id: userId, signature_svg: signatureSvg })
    .select()
    .single();
  if (insErr) {
    console.error("[signatures:insert] failed", insErr);
    return { success: false, error: insErr.message };
  }
  return { success: true, signature: fromRow(ins), replacement: false };
}

// Verifies the user's current password against Supabase Auth WITHOUT touching
// the main session. Creates a disposable second client that doesn't persist.
// Returns { success: true } on correct password, otherwise { success: false, error }.
export async function reauthenticateByPassword(email, password) {
  if (!isSupabaseEnabled()) {
    // Local mode has no Supabase auth; the design-doc rule is that signature
    // authorization requires live Supabase. Fail closed here.
    return { success: false, error: "Signature re-authentication requires Supabase mode." };
  }
  if (!email || !password) return { success: false, error: "Email and password required." };

  // Static imports: @supabase/supabase-js is already in the bundle via
  // getSupabase; env.js is already loaded at app boot. Keeps chunking clean.
  const disposable = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await disposable.auth.signInWithPassword({ email, password });
  if (error) {
    // Supabase returns "Invalid login credentials" — surface a cleaner message.
    const msg = /invalid|credentials|password/i.test(error.message || "")
      ? "Incorrect password. Try again."
      : (error.message || "Re-authentication failed.");
    return { success: false, error: msg };
  }
  if (!data?.user) return { success: false, error: "Re-authentication returned no user." };
  // Explicitly sign out of the disposable client so no token lingers.
  try { await disposable.auth.signOut(); } catch { /* best-effort */ }
  return { success: true };
}

function fromRow(r) {
  return {
    id:           r.id,
    userId:       r.user_id,
    signatureSvg: r.signature_svg,
    createdAt:    r.created_at || null,
    updatedAt:    r.updated_at || null,
  };
}
