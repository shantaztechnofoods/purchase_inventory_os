// Client wrapper for Supabase Edge Functions (User Management admin actions).
// All functions require a logged-in super_admin caller — the Edge Function verifies
// the JWT and rejects with 403 otherwise.

import { isSupabaseEnabled } from "../config/env.js";
import { getSupabase } from "../supabase/client.js";

async function callFn(name, body) {
  console.info(`[adminApi:${name}] start`, body && Object.keys(body));
  if (!isSupabaseEnabled()) {
    return { success: false, error: "Supabase mode disabled — admin API unavailable in local mode" };
  }
  const c = getSupabase();
  if (!c) return { success: false, error: "Supabase client not initialized" };

  let data, error;
  try {
    const result = await c.functions.invoke(name, { body });
    data  = result.data;
    error = result.error;
  } catch (thrown) {
    console.error(`[adminApi:${name}] threw`, thrown);
    return { success: false, error: `Network or invoke error: ${thrown?.message || String(thrown)}` };
  }

  if (error) {
    // Supabase-js wraps non-2xx responses in error.context (a Response object).
    // The actual error message from the function lives in the response body, NOT in error.message.
    // Extract it so we can show the real cause.
    let bodyText = null;
    let bodyJson = null;
    let httpStatus = null;
    try {
      if (error.context && typeof error.context.text === "function") {
        httpStatus = error.context.status;
        bodyText = await error.context.text();
        try { bodyJson = JSON.parse(bodyText); } catch { /* not JSON */ }
      }
    } catch (extractErr) {
      console.warn(`[adminApi:${name}] could not extract response body`, extractErr);
    }

    console.error(`[adminApi:${name}] FAILED`, {
      sdkMessage: error.message,
      httpStatus,
      responseBody: bodyJson || bodyText,
      requestBody: body,
    });

    const raw = String(error.message || error);

    // 404 / fetch failed → function not deployed
    if (httpStatus === 404 || /Failed to send a request|fetch failed|NetworkError|Not Found/i.test(raw)) {
      return {
        success: false,
        error: `Edge Function "${name}" is not deployed in your Supabase project. Deploy it via:\n    supabase functions deploy ${name}\nOR paste supabase/functions/${name}/index.ts in Dashboard → Edge Functions → New function.`,
        notDeployed: true,
      };
    }

    // Extracted a real error message from the function — surface it
    if (bodyJson?.error) {
      return { success: false, error: bodyJson.error, httpStatus, fullResponse: bodyJson };
    }
    if (bodyText) {
      return { success: false, error: `${name} returned HTTP ${httpStatus || "??"}: ${bodyText.slice(0, 500)}`, httpStatus };
    }

    return { success: false, error: `${name} failed (HTTP ${httpStatus || "??"}): ${raw}`, httpStatus };
  }
  if (data?.error) {
    console.error(`[adminApi:${name}] returned error`, data.error);
    return { success: false, error: data.error };
  }
  console.info(`[adminApi:${name}] ok`, data);
  return { success: true, ...data };
}

export const adminCreateUser     = (p) => callFn("admin-create-user",     p);
export const adminDeactivateUser = (p) => callFn("admin-deactivate-user", p);
export const adminDeleteUser     = (p) => callFn("admin-delete-user",     p);
export const adminResetPassword  = (p) => callFn("admin-reset-password",  p);
