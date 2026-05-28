// admin-deactivate-user
// Body: { userId, status }  status = "active" | "disabled"
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

  let body: { userId?: string; status?: string };
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }
  const { userId, status } = body;
  if (!userId)                                    return json(400, { error: "userId required" });
  if (!status || !["active","disabled"].includes(status))
                                                  return json(400, { error: "status must be active|disabled" });
  if (userId === user.id && status === "disabled") return json(400, { error: "Cannot disable yourself" });

  const { data: target } = await service.from("users").select("full_name, username, status").eq("id", userId).single();
  if (!target) return json(404, { error: "User not found" });

  const { error: updErr } = await service.from("users").update({ status }).eq("id", userId);
  if (updErr) return json(500, { error: updErr.message });

  await service.from("audit_log").insert({
    user_id: user.id, user_name: caller.full_name, user_role: caller.role_key,
    type: status === "disabled" ? "user_disabled" : "user_enabled",
    module: "User Mgmt",
    action: `User ${status === "disabled" ? "Disabled" : "Enabled"}: ${target.full_name} (${target.username})`,
    ref: userId,
    old_value: { status: target.status }, new_value: { status },
  });

  return json(200, { success: true });
});
