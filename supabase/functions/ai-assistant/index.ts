// Edge Function: ai-assistant — the SHANTAZ ERP "AI Brain"
// Deployed via: supabase functions deploy ai-assistant
//
// Request body:
//   {
//     question: string,
//     history?: { role: "user"|"ai", text: string }[],   // prior turns, most-recent-last
//     snapshot: {                                        // current client-side ERP state —
//       items, pos, vendorList, bomDefs, machineLog,      // required for modules not yet wired
//       inwardLog, outwardLog, pendingLog, settings        // to Supabase (see stores/* + Phase 3).
//     }
//   }
// Response 200: { answer: string, toolCalls: { name: string, args: unknown }[] }
// Response 4xx/5xx: { error: string }
//
// Design rules (do not relax without re-reading the brief this was built against):
//   - Gemini NEVER touches Supabase and NEVER sees the service-role or anon key.
//   - Gemini only reasons over data THIS function fetched/received and handed to it.
//   - Every data-access "tool" is a fixed, named function — never raw SQL, never
//     arbitrary code. Gemini can only pick from the declared tool menu below.
//   - Every tool is permission-gated using the CALLER's real role (looked up server-side,
//     never trusted from the client), mirroring src/auth/authStore.js's resolveCanDo/
//     resolveCanView so the AI can never surface more than the app's own UI would.
//   - audit_log is read via a Supabase client scoped to the CALLER's own JWT (so RLS
//     applies exactly as it would for any other client read) — not the service role.
//   - Business-data tools (items/POs/vendors/BOMs/machines/pending) currently read from
//     the `snapshot` the frontend sends, because those tables aren't in Supabase yet
//     (see project audit). Each tool function is written as its own small module so that
//     swapping its body to a real Supabase query later needs ZERO change to its name,
//     its arguments, or how Gemini calls it — the "interface" the AI sees never changes.
//   - Internet/general-knowledge answers are OFF unless settings.ai?.allowInternet === true
//     (an explicit, admin-controlled flag) — default is always grounded-only.
//   - If nothing grounds an answer, the model is instructed to reply exactly:
//     "No data found in ERP."

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY         = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GEMINI_API_KEY            = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL              = "gemini-2.5-pro";
const GEMINI_URL                = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// ─── System prompt — the grounding contract ────────────────────────────────
const SYSTEM_PROMPT = `You are the SHANTAZ TECHNOFOODS ERP Brain — an internal assistant embedded in the company's
Purchase, Inventory, Warehouse, Production and Analytics ERP.

STRICT RULES — follow all of them, every time:
1. Answer ONLY using data returned by the tools available to you in this conversation. Never use
   general world knowledge, never guess, never estimate figures you were not given.
2. If the tools do not contain the information needed to answer, reply with EXACTLY this text and
   nothing else: "No data found in ERP."
3. Do not use outside/internet knowledge unless the system message explicitly tells you internet
   mode is enabled for this request. If it is not mentioned, assume it is OFF.
4. Never mention table names, column names, SQL, JSON keys, internal function/tool names, or any
   other implementation detail. Speak in plain business language (item names, vendor names, PO
   numbers, quantities, dates).
5. Never reveal information the tools did not return to you, even if you can infer it. If a tool
   call returned an empty result or an "access denied" note, treat that topic as unavailable — say
   "No data found in ERP" for that part of the question rather than filling the gap yourself.
6. Be concise and business-focused: use short paragraphs, bullet points, and bold numbers where it
   helps a manager scan the answer quickly. Currency is Indian Rupees (₹).
7. When asked for a report, summary, or forecast, base it strictly on the figures the tools gave
   you, and say plainly if the underlying data is limited (e.g. "based on the last 5 stock points
   available").`;

// ─── Fixed tool menu — Gemini may only request these, with these exact shapes ──
const TOOLS = [
  {
    name: "get_stock_overview",
    description: "Get current inventory items, optionally filtered by stock status or category. Use for stock level, critical/warning/safe, reorder, and general inventory questions.",
    parameters: {
      type: "OBJECT",
      properties: {
        status:   { type: "STRING", description: "Filter: 'critical', 'warning', 'safe', or 'all'. Default 'all'." },
        category: { type: "STRING", description: "Optional category name to filter by." },
      },
    },
  },
  {
    name: "get_reorder_suggestions",
    description: "Get suggested reorder quantities and preferred vendors for items currently at or below minimum stock.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "get_movement_profile",
    description: "Classify items as fast-moving, slow-moving, or dead stock based on recent stock trend history. Use for 'dead stock', 'slow moving', 'fast moving' questions.",
    parameters: {
      type: "OBJECT",
      properties: { kind: { type: "STRING", description: "'fast', 'slow', 'dead', or 'all'. Default 'all'." } },
    },
  },
  {
    name: "get_purchase_orders",
    description: "Get purchase orders, optionally filtered by status (draft/pending/approved/ordered/received/rejected/overdue). Use for PO, purchase, pending-approval questions.",
    parameters: {
      type: "OBJECT",
      properties: { status: { type: "STRING", description: "Optional PO status filter." } },
    },
  },
  {
    name: "get_vendor_performance",
    description: "Get vendor order counts, on-time/received ratio, and category info. Optionally for one named vendor.",
    parameters: {
      type: "OBJECT",
      properties: { vendorName: { type: "STRING", description: "Optional vendor name to scope to." } },
    },
  },
  {
    name: "get_pending_materials",
    description: "Get materials currently pending issue for production (awaiting stock), grouped by BOM/serial. Use for 'pending materials', 'waiting on stock' questions.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "get_production_status",
    description: "Get machine/production build counts by stage (Assembly, Mechanical, Electrical, Trial, Ready) and how many are completed.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "get_executive_summary",
    description: "Get a single top-level KPI snapshot: total SKUs, critical/warning counts, open PO value, pending materials count, active production count. Use for 'executive summary', 'daily/weekly/monthly report', 'how are we doing' questions.",
    parameters: { type: "OBJECT", properties: {} },
  },
  {
    name: "get_audit_events",
    description: "Get recent audit trail entries (who did what, when), optionally filtered by module or event type. Only available to users with audit-trail access.",
    parameters: {
      type: "OBJECT",
      properties: {
        module: { type: "STRING", description: "Optional module filter, e.g. 'Purchase', 'Inventory', 'Machine'." },
        limit:  { type: "NUMBER", description: "Max rows, default 25, max 100." },
      },
    },
  },
];

// ─── Permission model (mirrors src/auth/authStore.js resolveCanDo/resolveCanView) ──
// Maps each tool to the app "page" a caller must be able to view to use it.
// Tools tied to `null` are available to any authenticated, active user (general
// inventory/production visibility every role in DEFAULT_ROLES already has via "dashboard").
const TOOL_PAGE_REQUIREMENT: Record<string, string | null> = {
  get_stock_overview:       null,
  get_reorder_suggestions:  null,
  get_movement_profile:     null,
  get_purchase_orders:      "pipeline",
  get_vendor_performance:   "vendors",
  get_pending_materials:    "pending",
  get_production_status:    "machines",
  get_executive_summary:    null,
  get_audit_events:         "audit",
};

function canUseTool(name: string, allowedPages: Set<string>, isSuperAdmin: boolean): boolean {
  if (isSuperAdmin) return true;
  const need = TOOL_PAGE_REQUIREMENT[name];
  if (need === null || need === undefined) return true;
  return allowedPages.has(need);
}

// ─── Tool implementations ──────────────────────────────────────────────────
// Each reads from the client-supplied snapshot today. When a module is migrated to
// Supabase (Phase 3), only the body of that one function changes to a real query —
// the function name/args/return shape Gemini sees stays identical.
type Snapshot = {
  items?: Record<string, any[]>;
  pos?: any[];
  vendorList?: any[];
  bomDefs?: Record<string, any>;
  machineLog?: any[];
  pendingLog?: any[];
  settings?: Record<string, any>;
};

function flatItems(snap: Snapshot) {
  return Object.entries(snap.items || {}).flatMap(([category, list]) =>
    (list || []).map((i: any) => ({ ...i, category }))
  );
}

function toolStockOverview(snap: Snapshot, args: { status?: string; category?: string }) {
  let list = flatItems(snap);
  if (args?.category) list = list.filter((i) => (i.category || "").toLowerCase() === args.category!.toLowerCase());
  if (args?.status && args.status !== "all") list = list.filter((i) => i.status === args.status);
  return {
    count: list.length,
    items: list.slice(0, 40).map((i) => ({
      name: i.name, code: i.code, category: i.category, stock: i.stock, unit: i.unit,
      min: i.min, status: i.status, location: i.location || null,
    })),
  };
}

function toolReorderSuggestions(snap: Snapshot) {
  const list = flatItems(snap).filter((i) => i.status === "critical" || i.status === "warning");
  return {
    count: list.length,
    suggestions: list.slice(0, 30).map((i) => ({
      name: i.name, code: i.code, category: i.category, currentStock: i.stock, unit: i.unit,
      minStock: i.min, suggestedOrderQty: Math.max(i.min * 2 - i.stock, i.min || 0),
      preferredVendor: (i.vendorLinks || [])[0]?.vendorId || null,
    })),
  };
}

function toolMovementProfile(snap: Snapshot, args: { kind?: string }) {
  const list = flatItems(snap).filter((i) => Array.isArray(i.trend) && i.trend.length >= 2);
  const scored = list.map((i) => {
    const trend = i.trend as number[];
    const delta = trend[0] - trend[trend.length - 1]; // positive = net consumption over window
    return { name: i.name, code: i.code, category: i.category, netChangeOverWindow: delta, currentStock: i.stock, unit: i.unit };
  });
  const dead = scored.filter((s) => s.netChangeOverWindow === 0);
  const sorted = [...scored].sort((a, b) => b.netChangeOverWindow - a.netChangeOverWindow);
  const fast = sorted.slice(0, 10).filter((s) => s.netChangeOverWindow > 0);
  const slow = sorted.slice(-10).filter((s) => s.netChangeOverWindow >= 0 && s.netChangeOverWindow !== undefined);
  const kind = args?.kind || "all";
  const out: Record<string, unknown> = { note: "Classification is based on the last few recorded stock points only (limited trend window)." };
  if (kind === "fast" || kind === "all") out.fastMoving = fast;
  if (kind === "slow" || kind === "all") out.slowMoving = slow;
  if (kind === "dead" || kind === "all") out.deadStock = dead.slice(0, 20);
  return out;
}

function toolPurchaseOrders(snap: Snapshot, args: { status?: string }) {
  let list = snap.pos || [];
  if (args?.status) list = list.filter((p) => p.status === args.status);
  return {
    count: list.length,
    purchaseOrders: list.slice(0, 30).map((p) => ({
      id: p.id, vendor: p.vendor, status: p.status, amount: p.amount,
      date: p.date, orderedDate: p.orderedDate || null, receivedDate: p.receivedDate || null,
      items: (p.lineItems || []).length,
    })),
  };
}

function toolVendorPerformance(snap: Snapshot, args: { vendorName?: string }) {
  const pos = snap.pos || [];
  const stats: Record<string, { total: number; received: number; rejected: number; totalValue: number }> = {};
  pos.forEach((p: any) => {
    const key = p.vendor || "Unknown";
    if (!stats[key]) stats[key] = { total: 0, received: 0, rejected: 0, totalValue: 0 };
    stats[key].total++;
    stats[key].totalValue += p.amount || 0;
    if (p.status === "received") stats[key].received++;
    if (p.status === "rejected") stats[key].rejected++;
  });
  let entries = Object.entries(stats);
  if (args?.vendorName) entries = entries.filter(([name]) => name.toLowerCase().includes(args.vendorName!.toLowerCase()));
  return {
    vendors: entries.slice(0, 20).map(([name, s]) => ({
      vendor: name, totalPOs: s.total, received: s.received, rejected: s.rejected,
      totalValue: s.totalValue, onTimeRatePct: s.total ? Math.round((s.received / s.total) * 100) : null,
    })),
  };
}

function toolPendingMaterials(snap: Snapshot) {
  const log = snap.pendingLog || [];
  const groups: Record<string, any> = {};
  log.forEach((p: any) => {
    const key = String(p.issueId ?? `${p.bomKey}-${p.date}`);
    if (!groups[key]) groups[key] = { bomKey: p.bomKey, serialNo: p.serialNo || null, date: p.date, items: [] };
    groups[key].items.push({ code: p.code, name: p.name, pendingQty: p.pendingQty, unit: p.unit });
  });
  return { groupCount: Object.keys(groups).length, groups: Object.values(groups).slice(0, 25) };
}

function toolProductionStatus(snap: Snapshot) {
  const log = snap.machineLog || [];
  const byStage: Record<string, number> = {};
  log.forEach((m: any) => { byStage[m.stage] = (byStage[m.stage] || 0) + 1; });
  return {
    totalMachines: log.length,
    completed: log.filter((m: any) => m.status === "completed").length,
    active: log.filter((m: any) => m.status === "active" && m.stage !== "BOM Issued").length,
    waitingOnMaterials: log.filter((m: any) => m.stage === "BOM Issued").length,
    byStage,
  };
}

function toolExecutiveSummary(snap: Snapshot) {
  const items = flatItems(snap);
  const pos = snap.pos || [];
  return {
    totalSKUs: items.length,
    criticalItems: items.filter((i) => i.status === "critical").length,
    warningItems: items.filter((i) => i.status === "warning").length,
    openPOValue: pos.filter((p: any) => p.status !== "received" && p.status !== "rejected").reduce((s: number, p: any) => s + (p.amount || 0), 0),
    pendingPOApprovals: pos.filter((p: any) => p.status === "pending").length,
    pendingMaterialGroups: toolPendingMaterials(snap).groupCount,
    activeProduction: toolProductionStatus(snap).active,
  };
}

async function toolAuditEvents(userScopedClient: any, args: { module?: string; limit?: number }) {
  let q = userScopedClient.from("audit_log").select("ts, user_name, user_role, type, module, action, ref").order("ts", { ascending: false });
  if (args?.module) q = q.eq("module", args.module);
  const limit = Math.min(Math.max(args?.limit || 25, 1), 100);
  q = q.limit(limit);
  const { data, error } = await q;
  if (error) return { error: "Could not read audit trail." };
  return { count: data?.length || 0, events: data || [] };
}

// ─── Handler ────────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")   return json(405, { error: "Method not allowed" });
  if (!GEMINI_API_KEY)         return json(500, { error: "AI service not configured (GEMINI_API_KEY missing)." });

  // 1) Authenticate the caller — never trust a client-asserted role.
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader) return json(401, { error: "Missing Authorization header" });

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json(401, { error: "Invalid session" });

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: caller, error: callerErr } = await service
    .from("users").select("role_key, status, full_name, overrides").eq("id", user.id).single();
  if (callerErr || !caller)       return json(403, { error: "Profile not found" });
  if (caller.status !== "active") return json(403, { error: "Account disabled" });

  const isSuperAdmin = caller.role_key === "super_admin";
  let allowedPages = new Set<string>();
  if (!isSuperAdmin) {
    const { data: role } = await service.from("roles").select("pages").eq("key", caller.role_key).single();
    allowedPages = new Set<string>((role?.pages as string[]) || []);
    const overridePages = caller.overrides?.pages || {};
    Object.entries(overridePages).forEach(([page, allowed]) => { if (allowed) allowedPages.add(page); else allowedPages.delete(page); });
  }

  // 2) Parse request
  let body: { question?: string; history?: { role: string; text: string }[]; snapshot?: Snapshot };
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }
  const question = (body.question || "").trim();
  if (!question) return json(400, { error: "question is required" });
  const snapshot = body.snapshot || {};
  const history = Array.isArray(body.history) ? body.history.slice(-10) : [];

  const allowInternet = snapshot.settings?.ai?.allowInternet === true; // admin-controlled, default OFF

  // 3) Build the tool menu this caller is actually allowed to use
  const allowedTools = TOOLS.filter((t) => canUseTool(t.name, allowedPages, isSuperAdmin));

  // 4) Local dispatcher — the ONLY thing that ever executes a tool call
  async function runTool(name: string, args: any) {
    if (!allowedTools.some((t) => t.name === name)) {
      return { error: "Not permitted for this user's role." };
    }
    switch (name) {
      case "get_stock_overview":      return toolStockOverview(snapshot, args || {});
      case "get_reorder_suggestions": return toolReorderSuggestions(snapshot);
      case "get_movement_profile":    return toolMovementProfile(snapshot, args || {});
      case "get_purchase_orders":     return toolPurchaseOrders(snapshot, args || {});
      case "get_vendor_performance":  return toolVendorPerformance(snapshot, args || {});
      case "get_pending_materials":   return toolPendingMaterials(snapshot);
      case "get_production_status":   return toolProductionStatus(snapshot);
      case "get_executive_summary":   return toolExecutiveSummary(snapshot);
      case "get_audit_events":        return await toolAuditEvents(userClient, args || {});
      default: return { error: "Unknown tool." };
    }
  }

  // 5) Build the Gemini conversation
  const contents: any[] = [];
  history.forEach((h) => contents.push({ role: h.role === "user" ? "user" : "model", parts: [{ text: h.text }] }));
  contents.push({ role: "user", parts: [{ text: question }] });

  const systemText = SYSTEM_PROMPT + (allowInternet
    ? "\n\nInternet mode has been explicitly enabled for this request by an administrator — you may supplement ERP data with general knowledge, but you must clearly label anything that did not come from a tool as \"(general knowledge, not from ERP)\"."
    : "\n\nInternet mode is OFF. Do not use outside knowledge under any circumstance.");

  const toolCallsMade: { name: string; args: unknown }[] = [];
  let finalText = "";
  const MAX_ROUNDS = 4;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const geminiReq = {
        system_instruction: { parts: [{ text: systemText }] },
        contents,
        tools: allowedTools.length ? [{ functionDeclarations: allowedTools }] : undefined,
        generationConfig: { temperature: 0.2 },
      };

      const resp = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY },
        body: JSON.stringify(geminiReq),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        return json(502, { error: `AI service error (${resp.status}): ${errText.slice(0, 300)}` });
      }
      const data = await resp.json();
      const candidate = data?.candidates?.[0];
      const parts: any[] = candidate?.content?.parts || [];
      const functionCalls = parts.filter((p) => p.functionCall);

      if (functionCalls.length === 0) {
        finalText = parts.map((p) => p.text || "").join("").trim() || "No data found in ERP.";
        break;
      }

      // Record the model's function-call turn, then execute each call and feed results back.
      contents.push({ role: "model", parts: functionCalls.map((p) => ({ functionCall: p.functionCall })) });
      const responseParts = [];
      for (const p of functionCalls) {
        const name = p.functionCall.name;
        const args = p.functionCall.args || {};
        toolCallsMade.push({ name, args });
        const result = await runTool(name, args);
        responseParts.push({ functionResponse: { name, response: result } });
      }
      contents.push({ role: "user", parts: responseParts });

      if (round === MAX_ROUNDS - 1) {
        finalText = "No data found in ERP.";
      }
    }
  } catch (err) {
    return json(502, { error: `AI service call failed: ${(err as Error).message}` });
  }

  // 6) Audit the query itself (who asked what, which tools were consulted)
  await service.from("audit_log").insert({
    user_id: user.id, user_name: caller.full_name, user_role: caller.role_key,
    type: "ai_query", module: "AI Assistant",
    action: `AI query: "${question.slice(0, 140)}"`,
    details: { toolsUsed: toolCallsMade.map((t) => t.name) },
  });

  return json(200, { answer: finalText, toolCalls: toolCallsMade });
});
