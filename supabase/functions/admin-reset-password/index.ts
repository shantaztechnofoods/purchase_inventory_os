// Edge Function: admin-reset-password
// Allows a super_admin to reset another user's password.
// Deployed via: supabase functions deploy admin-reset-password
//
// Request body:  { userId: string, newPassword: string }
// Response 200:  { success: true }
// Response 4xx:  { error: string }
//
// Auth: caller's JWT must belong to an active super_admin in public.users.
// All actions are written to audit_log.

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
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")   return json(405, { error: "Method not allowed" });

  // Verify caller is super_admin
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return json(401, { error: "Missing Authorization header" });

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json(401, { error: "Invalid session" });

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: caller, error: callerErr } = await service
    .from("users")
    .select("role_key, status, full_name")
    .eq("id", user.id)
    .single();

  if (callerErr || !caller)              return json(403, { error: "Profile not found" });
  if (caller.status !== "active")        return json(403, { error: "Account disabled" });
  if (caller.role_key !== "super_admin") return json(403, { error: "Super Admin only" });

  // Parse + validate
  let body: { userId?: string; newPassword?: string };
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }
  const { userId, newPassword } = body;
  if (!userId || typeof userId !== "string")             return json(400, { error: "userId required" });
  if (!newPassword || newPassword.length < 6)            return json(400, { error: "newPassword must be at least 6 characters" });

  // Fetch target profile (for audit naming)
  const { data: target } = await service.from("users").select("full_name, username").eq("id", userId).single();
  if (!target) return json(404, { error: "Target user not found" });

  // Reset
  const { error: resetErr } = await service.auth.admin.updateUserById(userId, { password: newPassword });
  if (resetErr) return json(500, { error: resetErr.message });

  // Audit
  await service.from("audit_log").insert({
    user_id:   user.id,
    user_name: caller.full_name,
    user_role: caller.role_key,
    type:      "user_password_reset",
    module:    "User Mgmt",
    action:    `Password Reset (admin): ${target.full_name} (${target.username})`,
    ref:       userId,
  });

  return json(200, { success: true });
});
