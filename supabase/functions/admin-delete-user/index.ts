// admin-delete-user — VERIFIED deletion
//
// Strategy: re-query AFTER every mutation. Never trust the success flag without
// confirming the row is actually gone. Returns 500 if profile row still exists
// after all delete attempts, no matter what the SDK said.
//
// Body: { userId }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY         = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")    return json(405, { error: "Method not allowed" });

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return json(401, { error: "Missing Authorization" });

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json(401, { error: "Invalid session" });

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: caller } = await service.from("users").select("role_key, status, full_name").eq("id", user.id).single();
  if (!caller || caller.status !== "active" || caller.role_key !== "super_admin")
    return json(403, { error: "Super Admin only" });

  let body: { userId?: string };
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }
  const { userId } = body;
  console.log("[admin-delete-user] START", { targetUserId: userId, caller: user.id });

  if (!userId)            return json(400, { error: "userId required" });
  if (userId === user.id) return json(400, { error: "Cannot delete yourself" });

  // ── Pre-check: target exists in public.users ──────────────────────────────
  const { data: target, error: targetErr } = await service.from("users")
    .select("id, full_name, username, role_key").eq("id", userId).maybeSingle();
  console.log("[admin-delete-user] pre-check public.users", { found: !!target, target, targetErr });
  if (targetErr)                         return json(500, { error: `Pre-check failed: ${targetErr.message}` });
  if (!target)                           return json(404, { error: "User not found in public.users" });
  if (target.role_key === "super_admin") return json(403, { error: "Cannot delete super_admin via API" });

  // ── Step 1: Try hard delete of auth.users (cascades to public.users via FK) ─
  const { error: authHardErr } = await service.auth.admin.deleteUser(userId);
  console.log("[admin-delete-user] STEP 1 — auth.admin.deleteUser(hard)", { error: authHardErr });

  // ── Step 2: VERIFY public.users row state after step 1 ────────────────────
  let { data: profileStillExists } = await service.from("users").select("id").eq("id", userId).maybeSingle();
  console.log("[admin-delete-user] STEP 2 — public.users after hard delete", { stillExists: !!profileStillExists });

  // ── Step 3: If profile still exists, explicitly DELETE it ─────────────────
  let explicitDeleteErr: string | null = null;
  let explicitDeleteCount: number | null = null;
  if (profileStillExists) {
    const { error, count } = await service.from("users").delete({ count: "exact" }).eq("id", userId);
    explicitDeleteErr = error?.message || null;
    explicitDeleteCount = count;
    console.log("[admin-delete-user] STEP 3 — explicit public.users delete", { error, count });

    // Re-check
    const recheck = await service.from("users").select("id").eq("id", userId).maybeSingle();
    profileStillExists = !!recheck.data;
    console.log("[admin-delete-user] STEP 3 — re-check public.users", { stillExists: profileStillExists });
  }

  // ── HARD VERIFICATION: profile row MUST be gone, otherwise FAIL ────────────
  if (profileStillExists) {
    const failPayload = {
      error: `Delete VERIFIED FAILED — public.users row for ${userId} still exists after delete attempts.`,
      details: {
        authHardError:        authHardErr?.message || null,
        explicitDeleteError:  explicitDeleteErr,
        explicitDeleteCount,
      },
      hint: "A foreign key constraint or trigger is blocking the delete. Check Postgres logs (Dashboard → Logs → Postgres) for the underlying SQLSTATE.",
    };
    console.error("[admin-delete-user] HARD-VERIFICATION FAILED", failPayload);
    return json(500, failPayload);
  }

  // ── Step 4: Verify auth.users state (best-effort, not blocking) ───────────
  let authStillExists = false;
  try {
    const { data: au } = await service.auth.admin.getUserById(userId);
    authStillExists = !!au?.user;
  } catch { /* ignore — auth state is secondary */ }
  console.log("[admin-delete-user] STEP 4 — auth.users state", { stillExists: authStillExists });

  // ── Step 5: If auth.users still exists but profile is gone, try once more ─
  if (authStillExists) {
    const { error: authSoftErr } = await service.auth.admin.deleteUser(userId, true);
    console.log("[admin-delete-user] STEP 5 — auth.admin.deleteUser(soft)", { error: authSoftErr });
  }

  // ── Step 6: Audit ─────────────────────────────────────────────────────────
  await service.from("audit_log").insert({
    user_id:   user.id,
    user_name: caller.full_name,
    user_role: caller.role_key,
    type:      "user_delete",
    module:    "User Mgmt",
    action:    `User Deleted: ${target.full_name || target.username} (${target.username})`,
    ref:       userId,
    old_value: { fullName: target.full_name, username: target.username, roleKey: target.role_key },
    details: {
      authHardError:        authHardErr?.message || null,
      authStillExistedAfter: authStillExists,
      explicitDeleteUsed:    !!explicitDeleteErr || explicitDeleteCount !== null,
      explicitDeleteCount,
    },
  });

  console.log("[admin-delete-user] SUCCESS", { userId, profileGone: true, authGone: !authStillExists });

  return json(200, {
    success: true,
    userId,
    profileDeleted: true,                 // hard-verified above
    authDeleted: !authStillExists,
    note: authStillExists
      ? "Profile removed; auth row remains (orphan). User cannot log in."
      : "User fully deleted",
  });
});
