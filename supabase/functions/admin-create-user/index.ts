// admin-create-user (username-based architecture)
// Body: { username, password, mobile?, roleKey, status? }
//
// - Validates username shape + uniqueness in public.users BEFORE creating auth user.
// - Synthesizes internal email: ${username}@users.shantaz.local
// - Validates roleKey exists in public.roles
// - Creates auth.users (triggers profile auto-creation via 009 trigger)
// - Upserts profile with caller-specified roleKey/status/mobile
// - Writes audit_log
//
// Email is internal — never exposed to UI or end users.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY         = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL_EMAIL_DOMAIN     = "users.shantaz.local";

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

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json(401, { error: "Invalid session" });

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: caller } = await service.from("users").select("role_key, status, full_name").eq("id", user.id).single();
  if (!caller || caller.status !== "active" || caller.role_key !== "super_admin")
    return json(403, { error: "Super Admin only" });

  let body: { username?: string; password?: string; mobile?: string; roleKey?: string; status?: string };
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }

  const { password, mobile, roleKey, status } = body;
  const rawInput = String(body.username || "").trim().toLowerCase();

  // Minimal validation — only what truly cannot be recovered from.
  if (!rawInput)  return json(400, { error: "Username is required" });
  if (!password)  return json(400, { error: "Password is required" });
  if (!roleKey)   return json(400, { error: "Role is required" });
  // Defensive sanitization: strip characters that would break email synthesis.
  // (No regex hard-reject — operator-friendly. We strip silently.)
  const cleanUsername = rawInput.replace(/[^a-z0-9_.\-]/g, "");
  if (!cleanUsername) return json(400, { error: "Username must contain at least one letter, digit, underscore, dot, or hyphen" });

  // Validate roleKey exists (super_admin allowed; other keys must exist in public.roles)
  if (roleKey !== "super_admin") {
    const { data: roleRow, error: roleErr } = await service.from("roles").select("key").eq("key", roleKey).maybeSingle();
    if (roleErr)   return json(500, { error: `Role lookup failed: ${roleErr.message}` });
    if (!roleRow)  return json(400, { error: `Invalid roleKey "${roleKey}" — not found in public.roles` });
  }

  // Pre-check username uniqueness in public.users (fail fast, clear message)
  const { data: existing, error: lookupErr } = await service.from("users")
    .select("id, username").eq("username", cleanUsername).maybeSingle();
  if (lookupErr) return json(500, { error: `Username lookup failed: ${lookupErr.message}` });
  if (existing)  return json(409, { error: `Username "${cleanUsername}" is already taken. Please choose a different username.` });

  // Synthesize internal email (never exposed to user)
  const email = `${cleanUsername}@${INTERNAL_EMAIL_DOMAIN}`;

  // Create auth user; trigger from 009 will create profile with default values
  const { data: authData, error: createErr } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: cleanUsername, username: cleanUsername },
  });
  if (createErr || !authData?.user) {
    // Special hint for trigger failure
    return json(500, {
      error: createErr?.message || "Auth user creation failed",
      hint: /Database error|trigger/i.test(createErr?.message || "")
        ? "The auth.users trigger failed. Run supabase/migrations/009_fix_user_trigger.sql to make it bulletproof."
        : undefined,
    });
  }

  // Upsert profile with caller-specified fields. Trigger may have set defaults; we overwrite with the requested values.
  const profilePayload = {
    id:        authData.user.id,
    username:  cleanUsername,
    full_name: cleanUsername,
    mobile:    mobile || null,
    role_key:  roleKey,
    status:    status || "active",
  };
  const { error: upsertErr } = await service.from("users").upsert(profilePayload, { onConflict: "id" });
  if (upsertErr) {
    return json(500, {
      error: `Profile upsert failed: ${upsertErr.message}`,
      hint: /unique constraint .*username/i.test(upsertErr.message || "")
        ? "Username collision between trigger-derived and caller-specified value. This should not happen with migration 009 — please verify the trigger is the new version."
        : undefined,
    });
  }

  // Audit log
  await service.from("audit_log").insert({
    user_id:   user.id,
    user_name: caller.full_name,
    user_role: caller.role_key,
    type:      "user_create",
    module:    "User Mgmt",
    action:    `User Created: ${cleanUsername} role=${roleKey}`,
    ref:       authData.user.id,
    new_value: { username: cleanUsername, roleKey, status: status || "active", mobile: mobile || null },
  });

  return json(200, {
    success:  true,
    userId:   authData.user.id,
    username: cleanUsername,
  });
});
