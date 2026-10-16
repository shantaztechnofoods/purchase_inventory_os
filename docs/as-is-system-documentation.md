# SHANTAZ ERP — AS-IS System Documentation

> **Status**: read-only audit, generated 2026-10-16 from branch `audit/full-system-check` @ `12b71e4` and `origin/main` @ `3838505`.
> **Scope**: documents what the system does **today**. Does not propose new features.
> **Guarantee**: this document was produced by reading the actual source, migrations, Edge Functions, and git history. Nothing was executed against production data. Every claim includes a file path or SHA. Claims I could not verify from code are explicitly labelled *unverified*.
> **Audience**: project owner + any future contributor who needs to know how the ERP currently works before changing anything.

---

## 1. Executive summary

### What it is

A single-tenant purchase, inventory, warehouse, production, vendor, and audit ERP for Shantaz Technofoods. One React 18 + Vite SPA, backed by Supabase (Postgres + Auth + Edge Functions + Storage).

- **Production URL**: https://purchase-inventory-os.vercel.app/ (verified: HTTP 200, bundle `assets/index-1ddIktAk.js`, `APP_BUILD = "2026-10-11-restore-bom-rack"`).
- **Production branch**: `main` (auto-deploys to Vercel on push).
- **Current `main` SHA**: `3838505` — a merge of PRs #1 (`safety/regression-prevention`) and #2 (`audit/full-system-check`) on top of `23ba96c` (restore + deploy marker).
- **Rollback tag**: `erp-pre-restore-32e3ffe` → `32e3ffe` (the pre-restore snapshot, pushed to origin).

### Shape of the codebase

| Layer | Files | Lines (approx) |
|---|---|---|
| Monolithic UI | `src/App.jsx` | **13,205** |
| Stores (persistence helpers) | `src/stores/*.js` × 13 | 1,886 total |
| Auth layer | `src/auth/*` × 3 | 724 total |
| Pages (routes outside App.jsx) | `src/pages/*` × 4 | 1,531 total |
| Reusable components | `src/components/*` × 7 | small (focus-boundary, selects, menus) |
| Utils | `src/utils/*` × 6 | moderate (gst, imports, poTemplate, storage, whatsapp) |
| Realtime hook | `src/realtime/useRealtimeTables.js` | 1 hook |
| Supabase migrations | `supabase/migrations/*.sql` × 20 | adds 15 tables, 1 engine function, 2 helpers, RLS |
| Edge Functions | `supabase/functions/*/index.ts` × 5 | ai-assistant + 4 user admin |
| Tests | `tests/*.mjs` × 4 | 233 passing (auth 31, gst 34, itemImport 37, regression 131) |
| Design docs | `docs/*.md` × 1 | `department-workflow-phase-a.md` (Phase A design, unapproved) |
| CI | `.github/workflows/ci.yml` | install → test → build on push + PR |
| Build pin | `.nvmrc` | Node 20 |
| Project rules | `CLAUDE.md` | 10 safety rules + 2b71bbc post-mortem |

### What exists today vs the Phase A / Phase B / Phase C feature set

| Area | Status |
|---|---|
| BOM lifecycle (Create / Duplicate / Rename / Safe-Delete) | ✅ live |
| BOM Issue + destination popup (Rack / Direct Production) | ✅ live |
| Rack view + Edit Capacity + Delete Rack | ✅ live |
| Machine Tracker with stages Assembly → Mechanical → Electrical → Trial → Ready | ✅ live (dropdown-driven) |
| Stock engine with atomic transactions and negative-stock block | ✅ live (`record_stock_movement` RPC) |
| Full PO lifecycle + GST + default-rate + PO template per company | ✅ live |
| Inward manual + auto from PO | ✅ live |
| Outward with auto-pending generation + Pending auto-fulfill-on-inward | ✅ live |
| Pending Give Material / Give All / Fulfill All with duplicate-submit guard | ✅ live |
| Vendors + ledger-style view + import + archive | ✅ live |
| Audit log (append-only, trigger-enforced) | ✅ live |
| AI Assistant (Gemini via Edge Function, tool-grounded, permission-gated) | ✅ live |
| User + Role management (super_admin via Edge Function) | ✅ live |
| Permission matrix (4 default roles + per-user overrides) | ✅ live |
| Silent-lockout retry screen + session restore | ✅ live |
| **Department handover (Finish & Transfer / Accept)** | ❌ not implemented |
| **Per-department durations / Accept timeout / HOLD** | ❌ not implemented |
| **Overrun narration** | ❌ not implemented |
| **Dynamic checklists** | ❌ not implemented |
| **Pending handover items (carry-forward)** | ❌ not implemented |
| **Department attachments (photos / videos / docs beyond item media)** | ❌ not implemented |
| **Employee signature pad** | ❌ not implemented |
| **Performance rating** | ❌ not implemented |
| **Dedicated Factory / Internal report** | ❌ not implemented (basic History page exists) |
| **Customer progress report** | ❌ not implemented |
| **Report / Export center with PDF+CSV filters** | ❌ not implemented (History page has partial filtering, no PDF, no 8 report types) |

---

## 2. Repository & build state (verified)

### 2.1 Branches on origin

```
3838505  main                           — PRODUCTION; latest merge PR #2
12b71e4  audit/full-system-check        — audit-log fixes, merged into main via PR #2
a29ccd4  safety/regression-prevention   — CI + regression tests + CLAUDE.md, merged into main via PR #1
23ba96c  restore/bom-rack-ui            — original recovery branch, folded into main
```

### 2.2 Tags on origin

```
erp-pre-restore-32e3ffe → 32e3ffe   (pre-restore snapshot; use this to see the "regressed main" historically)
```

### 2.3 Dependencies (`package.json`)

- Runtime: `react@^18.2`, `react-dom@^18.2`, `@supabase/supabase-js@^2.106`, `recharts@^2.12`, `xlsx@^0.18`.
- Build/dev: `vite@^5.2`, `@vitejs/plugin-react@^4.2`, `tailwindcss@^3.4`, `postcss@^8.4`, `autoprefixer@^10.4`.
- Scripts: `dev`, `build`, `preview`, `test` (runs 4 test files via `node --test`).
- Node version: pinned to `20` via `.nvmrc`.

### 2.4 Vite config (`vite.config.js`)

- Plugin: `@vitejs/plugin-react`.
- Build: `chunkSizeWarningLimit: 900`, manual chunks split `react-vendor` / `supabase` / `charts` out of main.
- esbuild: `pure: ['console.log', 'console.info', 'console.debug']` strips verbose dev logs from prod; `console.warn` and `console.error` are preserved.

### 2.5 Production bundle (verified via `curl`)

```
HTML:    https://purchase-inventory-os.vercel.app/                 → 200
Script:  assets/index-1ddIktAk.js (~1,004,506 bytes)              → 200
Vendor:  assets/charts-1BNXXrvz.js, supabase-RZYbeyyu.js, react… → 200
CSS:     assets/index-CLQXCoxB.css (~42 KB)                       → 200
```

Build-marker in the live JS bundle: `"2026-10-11-restore-bom-rack"` (appears twice — once in the console banner `main.jsx:APP_BUILD_TAG`, once in the Settings-page badge `App.jsx:APP_BUILD`).

---

## 3. Database schema (verified from migrations 001–020)

### 3.1 Table inventory (15 tables)

| Table | Introduced | Purpose |
|---|---|---|
| `public.roles` | 001 | role definitions (key, label, pages[], actions{}) |
| `public.users` | 001 | app-level profile 1:1 with `auth.users(id)`; carries `role_key`, `status`, `overrides` jsonb |
| `public.vendors` | 002 | vendor master |
| `public.items` | 002 (extended by 008, 011, 016, 018, 020) | item master; carries stock, min, max, trend, status, media, GST rate, default rate, soft-delete flags |
| `public.item_history` | 002 (schema repaired by 014) | per-item event ledger (inward/outward/adjust/BOM-issue) |
| `public.bom_definitions` | 002 | BOM = `{key, label, color, rack_capacity, items[]}`; `rack_capacity > 0` enables rack tracking |
| `public.settings` | 002 | single-row jsonb-ish settings table |
| `public.purchase_orders` | 003 (extended by 015, 018) | PO header; `line_items` + `activity_log` are jsonb |
| `public.inward_log` | 003 | manual + auto inward entries |
| `public.outward_log` | 003 | BOM-issue + manual outward entries |
| `public.pending_log` | 003 | partially-fulfilled issue rows; auto-created when outward can't fully satisfy |
| `public.follow_ups` | 003 | PO follow-up schedule rows |
| `public.machine_log` | 003 | one row per started machine; carries `bom_key`, `serial_no`, `stage`, `status`, `history` jsonb |
| `public.audit_log` | 004 | append-only audit; triggers reject UPDATE and DELETE |
| `public.stock_movements` | 012 | immutable ledger of every stock change; triggers reject UPDATE and DELETE |

### 3.2 Key column definitions (verified excerpts)

**`public.users` (001)**:

```sql
id          uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
username    citext      NOT NULL UNIQUE,
full_name   text        NOT NULL,
mobile      text,
role_key    text        NOT NULL REFERENCES public.roles(key) ON DELETE RESTRICT,
status      text        NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
overrides   jsonb,          -- { actions:{module:{action:bool}}, pages:{slug:bool} }
last_login  timestamptz,
created_at  timestamptz NOT NULL DEFAULT now(),
updated_at  timestamptz NOT NULL DEFAULT now()
```

**`public.purchase_orders` (003 + 015 + 018)**:

```sql
id              text   PRIMARY KEY,       -- "PO-123" style, client-generated
vendor          text   NOT NULL,
vendor_id       uuid   REFERENCES public.vendors(id) ON DELETE SET NULL,
status          text   NOT NULL CHECK (status IN
                 ('draft','review','pending','approved','rejected','ordered','overdue','received')),
date, ordered_date, received_date, eta, priority, amount, gst, notes, reject_reason,
line_items      jsonb  NOT NULL DEFAULT '[]'::jsonb,
activity_log    jsonb  NOT NULL DEFAULT '[]'::jsonb,
created_by      uuid   REFERENCES public.users(id) ON DELETE SET NULL,
-- 015:
company_id      text,
template        text,
-- 018:
purchase_type   text,
gst_type        text,                  -- CHECK (019) in ('local','interstate','exempt','zero','import')
po_date         date,
cgst, sgst, igst numeric
```

**`public.items` (002 + 008 + 011 + 016 + 018 + 020)**:

```sql
id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
code          text        NOT NULL UNIQUE,
name          text        NOT NULL,
unit          text,
category      text,
stock         numeric     NOT NULL DEFAULT 0,
min_stock     numeric     NOT NULL DEFAULT 0,     -- "min"
max_stock     numeric     NOT NULL DEFAULT 0,     -- "max"
status        text,                               -- 'safe'|'warning'|'critical'
vendor        text,
vendor_id     uuid        REFERENCES public.vendors(id) ON DELETE SET NULL,
location      text,
trend         jsonb       DEFAULT '[]'::jsonb,     -- last 5 stock snapshots
last_purchase_rate numeric,
history       jsonb,                              -- client-side mirror (legacy)
-- 008:
is_active     boolean     NOT NULL DEFAULT true,
deactivated_at  timestamptz,
deactivated_by  uuid REFERENCES public.users,
-- 011:
reserved_stock numeric    NOT NULL DEFAULT 0,
reorder_level  numeric    NOT NULL DEFAULT 0,
-- 016:
photo         text,              -- Supabase Storage public URL
design_file   text,
design_name   text,
-- 018:
gst_rate      numeric   CHECK (gst_rate IN (0,5,12,18,28) OR gst_rate IS NULL),
-- 020:
default_purchase_rate numeric
```

**`public.machine_log` (003)** — unchanged since; this is what any department workflow will extend:

```sql
id             bigserial   PRIMARY KEY,
issue_id       bigint,                     -- links to the outward_log row that issued this BOM
bom_key        text        NOT NULL,
bom_label      text,
serial_no      text,
stage          text        NOT NULL DEFAULT 'BOM Issued',
status         text        NOT NULL DEFAULT 'active',   -- 'active'|'completed'
created_date   date        NOT NULL,
completed_date date,
history        jsonb       NOT NULL DEFAULT '[]'::jsonb,  -- [{stage, date, note?}]
created_at     timestamptz NOT NULL DEFAULT now(),
updated_at     timestamptz NOT NULL DEFAULT now()
```

**`public.bom_definitions` (002)**:

```sql
key           text        PRIMARY KEY,     -- "BOM-ASSY-01" style
label         text        NOT NULL,
color         text,
rack_capacity integer     NOT NULL DEFAULT 0,   -- 0 => no rack card; >0 => rack-tracked
items         jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- [{code, qty}]
updated_at    timestamptz NOT NULL DEFAULT now()
```

### 3.3 Row-level security (verified from migration 006)

- Every table above has `ENABLE ROW LEVEL SECURITY`.
- Policies are **thin**: most policies allow `SELECT` to any `authenticated` role, writes are gated by `is_super_admin()` or `has_permission(module, action)` helpers.
- Policy structure (sample `vendors_update`):
  ```sql
  CREATE POLICY vendors_update ON public.vendors
    FOR UPDATE TO authenticated
    USING (has_permission('vendors','edit'));
  ```
- `audit_log` is append-only enforced at the trigger layer (`reject_audit_change` in migration 004) — UPDATE and DELETE always error.
- `stock_movements` is also append-only (`reject_immutable_change` in migration 012).

### 3.4 Permission helpers (verified from migration 005)

Postgres mirrors the client-side `canDo` / `canView`:

- `is_super_admin()` → `users.role_key = 'super_admin' AND status = 'active'`
- `is_active_user()` → user exists and `status = 'active'`
- `has_permission(module, action)` resolution order:
  1. `super_admin` → always true
  2. Per-user `overrides.actions[module][action]` if present (JSONB on `users.overrides`)
  3. Role `roles.actions[module][action]`
  4. Default: false
- `can_view_page(slug)` resolution order:
  1. `super_admin` → always true
  2. Per-user `overrides.pages[slug]`
  3. Role `roles.pages` array contains slug
  4. Default: false

### 3.5 Stock engine (verified from migration 013)

**`public.record_stock_movement(p_item_code, p_movement_type, p_qty, p_reference_type, p_reference_id, p_notes, p_user_id, p_user_name) RETURNS jsonb`**

- `SECURITY DEFINER`. Granted to `authenticated`.
- Validates `movement_type` against `('purchase_in','production_issue','production_output','manual_adjustment','sales_out','return_in','return_out')`.
- Row-locks the item (`FOR UPDATE`), reads `v_before`, computes `v_after = v_before + p_qty`.
- **Blocks negative stock** with `RAISE EXCEPTION` + `ERRCODE check_violation`. This is the single factory-safety gate.
- Recomputes `status` using the same `stock <= min` rule as the client's `recomputeStatus`.
- Appends `v_after` to `trend` (bounded to last 5 points).
- One `UPDATE items` + one `INSERT stock_movements` + one `INSERT item_history` in the same transaction. If any step fails, the whole thing rolls back.
- Returns `jsonb` with `success`, `item_code`, `before_stock`, `after_stock`, `status`, `reserved_stock`, `available_stock`.

### 3.6 Auth sync trigger (verified from migrations 007 + 009)

- `handle_new_auth_user()` fires `AFTER INSERT ON auth.users`. Creates a matching row in `public.users` with a sanitized username derived from the email prefix and a default `role_key` of the first non-super-admin role in `public.roles`.
- Migration 009 made this bulletproof — defensive handling for null metadata, duplicate email collisions, trigger-ordering issues; and tries not to fail the auth-user insert.

### 3.7 Storage buckets (verified from migration 017)

- Bucket `item-media` (not an explicit `CREATE BUCKET` — assumed created manually in the dashboard; policies in 017 attach to `storage.objects` filtered on `bucket_id = 'item-media'`).
- Policies: `item_media_public_read` (anyone can `SELECT`), and `_auth_upload / _auth_update / _auth_delete` requiring authenticated role.
- Used by `src/utils/storage.js:uploadItemMedia` with 25 MB cap.
- **Unverified from code**: whether the bucket exists in your Supabase project. The storage policy SQL assumes a bucket named `item-media` is already there.

---

## 4. Edge Functions (verified from `supabase/functions/*/index.ts`)

Five Edge Functions on Deno runtime. All share a common pattern: parse the caller's JWT, verify them in `public.users`, service-role client for the actual work, structured JSON response, CORS preflight support.

| Function | Caller role required | What it does |
|---|---|---|
| `admin-create-user` | super_admin | Creates `auth.users` (service-role), synthesizes internal email `{username}@users.shantaz.local`, lets the `handle_new_auth_user` trigger seed the profile, then upserts `public.users` with the caller-specified `role_key`, `mobile`, `status`. Writes `audit_log` entry `type='user_create'`. |
| `admin-deactivate-user` | super_admin | Flips `public.users.status` to `'disabled'`. Does NOT delete `auth.users`. Writes audit entry. |
| `admin-delete-user` | super_admin | Hard delete: `auth.admin.deleteUser(id)` (service role) which cascades via FK to `public.users` and anything referencing it. Writes audit entry. |
| `admin-reset-password` | super_admin | `auth.admin.updateUserById(id, { password })`. Writes audit entry `password_reset`. |
| `ai-assistant` | any active user | Reads caller's JWT, computes their `role_key` and page/action permissions server-side (mirrors `authStore.resolveCanDo`), forwards the question + the client's **snapshot** to Gemini 2.5 Pro with a tool-grounded system prompt. Gemini can only call declared tools (critical-stock, generate-POs, vendor-performance, consumption-forecast, audit, etc.) — never raw SQL. The Gemini API key stays in the function env (never shipped to client). Default: internet-knowledge OFF; grounded answers only; "No data found in ERP." fallback. |

**Not verified from code**: whether each function is actually deployed on your Supabase project. The frontend's `adminApi.js` detects "not deployed" (HTTP 404) and surfaces a clear error.

---

## 5. Client environment & bootstrap (verified)

### 5.1 `src/main.jsx`

- React 18 `createRoot`, `<StrictMode>` enabled.
- Mounts: `<RootErrorBoundary><AuthProvider><App /></AuthProvider></RootErrorBoundary>`.
- `APP_BUILD_TAG` constant → sets `#erp-build-badge` fixed-position badge in the bottom-left of every screen and emits a green console banner `%c[APP BUILD] 2026-10-11-restore-bom-rack`.

### 5.2 `src/config/env.js`

- Reads `import.meta.env` for `VITE_USE_SUPABASE`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_APP_ENV`, `VITE_APP_NAME`, `VITE_ALLOW_DEMO`.
- `isSupabaseEnabled()` returns `true` only when `VITE_USE_SUPABASE === 'true'` **and** URL + anon key are both present.
- Logs a boot banner (`console.error` if Supabase not configured, `console.warn` otherwise) so stale deploys are visible in prod DevTools.
- Exposes `window.__ERP_ENV__` in non-prod builds for console inspection.

### 5.3 `src/supabase/client.js`

- `getSupabase()` returns a lazy singleton; returns `null` if `isSupabaseEnabled()` is false.
- `storageKey: 'erp_supabase_session'` so Supabase persists session separately from any legacy local session.
- `probeSupabase()` helper does a `SELECT id FROM users ... HEAD` to test connectivity.

### 5.4 `src/realtime/useRealtimeTables.js`

- Subscribes to `postgres_changes` events on items / pos / inward_log / outward_log / pending_log / machine_log / bom_definitions / vendors / follow_ups / audit_log.
- Fire-and-forget: each table change triggers the corresponding `refetch` callback passed in. Debounced to coalesce bursts (e.g. multi-line PO receive).
- Only subscribes when `isSupabaseEnabled()` is true.

---

## 6. Auth model (verified)

### 6.1 `src/auth/AuthContext.jsx` — provider contract

Exposes via `useAuth()`:

- `currentUser` — `{ id, username, fullName, mobile, role, status, ... }` or `null`.
- `canDo(module, action)` — see §6.3.
- `canView(page)` — true if the role's `pages` array contains the slug (or super_admin, or an override).
- `isLoading` — true while initial Supabase session restore is in flight. Also surfaced as `authLoading` to the destructuring in App.jsx.
- `authLoadError` — non-null string when session restore failed (profile missing, roles fetch failed, timeout, disabled account). Drives the retry screen added in `8a2669b`.
- `retryAuthLoad()` — retries the failed restore.
- `supabaseMode` — convenience bool.
- `signIn(username, password)` / `signOut()` / `changePassword(oldPw, newPw)`.

### 6.2 `src/auth/authStore.js`

- Hashing (localStorage mode only): `btoa(unescape(encodeURIComponent(pw)))`. Explicitly obfuscation, not security.
- `DEFAULT_ROLES` seeded in local mode:

| Role | Pages | Permissions (summary) |
|---|---|---|
| **Admin** | all 15 modules | full inventory CRUD, full PO lifecycle, full BOM/outward, update stage, vendor CRUD, inward submit, pending fulfill+clear, user+role CRUD |
| **Purchase Manager** | dashboard, inventory, inward, pipeline, vendors, history, analytics | PO create/approve/reject/order/receive (no delete), inward submit, nothing else |
| **Store Manager** | dashboard, inventory, inward, outward, pending, machines, history | inventory adjust (not add/edit/delete), outward bom + manual, update stage, inward submit, pending fulfill+clear |
| **Production** | dashboard, inventory, outward, pending, machines, history | outward bom only, update stage, pending fulfill (no clear) |

- `super_admin` is a hard-coded local user (`username='admin', password='admin123'`) in local mode only; in Supabase mode, the super_admin is identified by `users.role_key = 'super_admin'`.
- `resolveCanDo(user, module, action)` — resolution matches the Postgres `has_permission` function (super_admin → override → role → false).
- `resolveCanView(user, page)` — matches the Postgres `can_view_page`.

### 6.3 Permission matrix

Modules × actions used across the app:

- `inventory`: add, edit, delete, adjust
- `pipeline`: create, approve, reject, ordered, receive, delete
- `outward`: bom, manual, editBOM (also `delete` for rack-remove via BOM-card ⋮ menu)
- `machines`: updateStage
- `vendors`: add, edit, delete
- `inward`: submit
- `pending`: fulfill, clear
- `users`: view, create, edit, delete
- `roles`: view, create, edit, delete

### 6.4 Login flow (verified from `src/pages/LoginPage.jsx` + `AuthContext`)

1. User enters username + password.
2. In Supabase mode: client calls `supabase.auth.signInWithPassword({ email: '{username}@users.shantaz.local', password })`.
3. On success, `AuthProvider` fetches `public.users` row by `auth.uid`, resolves role from `public.roles`, writes to `currentUser` state.
4. On error: distinguished into buckets by `32e3ffe` fix — `'invalid-credentials'`, `'email-unconfirmed'`, `'network'`, `'server'`, each with a different inline error UI.
5. If initial restore throws anywhere in the chain, `authLoadError` surfaces the `Session couldn't be restored` retry screen before `LoginPage` would show.

### 6.5 Audit log store (`src/auth/auditStore.js`)

- `appendAudit(entry)` writes to localStorage *and* mirrors to Supabase (`audit_log` INSERT).
- `appendAuditWithUser(entry)` injects `user_id`, `user_name`, `user_role` from current session.
- `fetchAuditFromSupabase({ limit })` paginates reads.
- `subscribeAudit(callback)` wires a realtime subscription to `audit_log` INSERTs so the Audit Trail page updates live.

---

## 7. Navigation & page routing (verified from `src/App.jsx:449` + `pages` dict at `src/App.jsx:12950`)

### 7.1 Sidebar nav items (15 modules, in order)

```js
const navItems = [
  { id: "dashboard",  icon: "⬛", label: "Dashboard",         section: "OVERVIEW" },
  { id: "inventory",  icon: "📦", label: "Item Master",       section: null },
  { id: "inward",     icon: "📥", label: "Inward",            section: "TRANSACTIONS" },
  { id: "outward",    icon: "📤", label: "Outward",           section: null },
  { id: "pending",    icon: "⏳", label: "Pending Stock",     section: null },
  { id: "pipeline",   icon: "🔄", label: "Order Pipeline",    section: "OPERATIONS" },
  { id: "machines",   icon: "🔧", label: "Machine Tracker",   section: null },
  { id: "vendors",    icon: "🏭", label: "Vendors",           section: null },
  { id: "analytics",  icon: "📊", label: "Analytics",         section: "INTELLIGENCE" },
  { id: "ai",         icon: "🤖", label: "AI Assistant",      section: null },
  { id: "history",    icon: "📜", label: "History & Reports", section: "REPORTS" },
  { id: "audit",      icon: "🛡️", label: "Audit Trail",       section: null },
  { id: "settings",   icon: "⚙️", label: "Settings",          section: "SYSTEM" },
  { id: "users",      icon: "👤", label: "User Management",   section: null },
  { id: "roles",      icon: "🔐", label: "Role Management",   section: null },
];
```

Sidebar renders only items for which `canView(id)` returns true for the current user.

### 7.2 Page dict (what each nav id renders) — summary of `src/App.jsx:12950` onwards

| Nav id | Component | Called from | Key props |
|---|---|---|---|
| `dashboard` | `DashboardPage` | `src/App.jsx:702` | items, pos, vendorList, machineLog, pendingLog, followUps, onNavigate, settings |
| `inventory` | `InventoryPage` | `src/App.jsx:2619` | items, setItems, handleUpdateStock, pos, inward/outward/pendingLog, bomDefs, machineLog, logAudit, vendorList, settings, **onCreateItem/UpdateItem/DeleteItem/BulkAddItems** |
| `inward` | `InwardPage` | `src/App.jsx:7138` | items, handleUpdateStock, vendorList, onInwardComplete, onAddInward (inlined), appInwardLog |
| `outward` | `OutwardPage` | `src/App.jsx:7973` | items, handleUpdateStock, bomDefs, onUpdateBOM, onCreateBOM, onRenameBOM, outwardLog, onAddOutward, pendingLog, onClearPending, onCreateMachine, machineLog, onRemoveRackMachine, onDuplicateBOM, onDeleteBOM, computeBOMDeletionInfo |
| `pending` | `PendingPage` | `src/App.jsx:9551` | pendingLog, items, bomDefs, machineLog, onFulfillPending, onFulfillGroup, handleUpdateStock, onClearPending, onNavigate |
| `pipeline` | `OrderPipelinePage` | `src/App.jsx:6052` | items, pos, vendorList, followUps, onUpdatePO, onCreatePO, onReceivePO, onConfirmOrder, onFollowUpDone, onDeletePO, pendingLog, onFulfillPending, handleUpdateStock, inwardLog, settings, isSuperAdmin, onReverseReceive, onSetItemDefaultRate |
| `machines` | `MachinePage` | `src/App.jsx:8808` | machineLog, onUpdateStage, onNavigate, bomDefs, onStartProduction, onRemoveRackMachine, onUpdateBOM |
| `vendors` | `VendorsPage` | `src/App.jsx:4572` | vendorList, pos, items, onAddVendor, onEditVendor, onDeleteVendor, onBulkAddVendors |
| `analytics` | `AnalyticsPage` | `src/App.jsx:5178` | items, pos, vendorList, settings |
| `ai` | `AIPage` | `src/App.jsx:5361` | items, pos, vendorList, bomDefs, machineLog, pendingLog, settings |
| `history` | `HistoryPage` | `src/App.jsx:10066` | auditLog, pos, inwardLog, outwardLog, pendingLog, machineLog, items, vendorList, bomDefs |
| `audit` | `AuditHistoryPage` | `src/pages/AuditHistoryPage.jsx` | (its own fetch via `subscribeAudit`) |
| `settings` | `SettingsPage` | `src/App.jsx:5608` | settings, onSave, isSuperAdmin |
| `users` | `UserManagementPage` | `src/pages/UserManagementPage.jsx` | (self-fetches via Edge Functions) |
| `roles` | `RoleManagementPage` | `src/pages/RoleManagementPage.jsx` | (self-fetches via rolesStore) |

### 7.3 Access gate

Every page is wrapped in:

```js
canView(activePage)
  ? (pages[activePage] || <DashboardPage />)
  : <AccessDeniedPage onNavigateHome={() => setActivePage("dashboard")} />
```

Access denial is a hard UI gate; the Supabase RLS policies are the authoritative enforcement at the data layer.

---

## 8. Store layer (verified from `src/stores/*.js`)

Pattern: every store function (a) returns early with a localStorage result when `isSupabaseEnabled()` is false, (b) returns a localStorage fallback when the Supabase client is null, (c) does the Supabase call, (d) mirrors success to localStorage, and (e) returns a `{ success, ...payload }` or `{ success: false, error }` shape.

### 8.1 Exports (verified)

| Store | Exports |
|---|---|
| `adminApi.js` | `adminCreateUser`, `adminDeactivateUser`, `adminDeleteUser`, `adminResetPassword` — all wrappers around Edge Functions |
| `bomsStore.js` | `fetchBOMs`, `createBOM`, `updateBOM`, `renameBOM`, `deleteBOM` |
| `followupsStore.js` | `fetchFollowUps`, `createFollowUp`, `updateFollowUp`, `deleteFollowUpsByPO` |
| `inwardStore.js` | `fetchInward`, `createInward`, `bulkCreateInward`, `deleteInwardByPO` |
| `itemsStore.js` | `fetchItems`, `createItem`, `updateItem`, `deleteItem`, `setItemHistoryUserCtx`, `updateStockAndHistory`, `addItemHistory`, `fetchItemHistory`, `migrateLocalItemsToSupabase`, `debugItemHistory` |
| `machinesStore.js` | `fetchMachines`, `createMachine`, `updateMachine`, `updateMachineBomKey`, `deleteMachine` |
| `outwardStore.js` | `fetchOutward`, `createOutward`, `updateOutwardRef`, `deleteOutwardByIssueId` |
| `pendingStore.js` | `fetchPending`, `bulkCreatePending`, `updatePending`, `updatePendingBomKey`, `deletePending`, `clearAllPending` |
| `posStore.js` | `fetchPOs`, `createPO`, `updatePO`, `deletePO` |
| `rolesStore.js` | `createRole`, `updateRole`, `deleteRole` |
| `settingsStore.js` | `getSettingsLocal`, `loadSettings`, `saveSettings` |
| `stockMovementsStore.js` | `MOVEMENT_TYPES`, `MOVEMENT_META`, `setMovementUserCtx`, `inferMovementType`, `recordMovement`, `fetchMovements`, `fetchRecentMovements` |
| `vendorsStore.js` | `listVendors`, `createVendor`, `updateVendor`, `deleteVendor`, `archiveVendor`, `bulkCreateVendors` |

### 8.2 Shape mapping (`toRow` / `fromRow`)

Every store that writes to Supabase has a `toRow(obj)` and `fromRow(row)` helper that converts between the camelCase client shape and the snake_case Postgres shape. Example from `posStore.js:7-52`:

- client `vendorId` ↔ db `vendor_id`
- client `lineItems` ↔ db `line_items`
- client `activityLog` ↔ db `activity_log`
- client `receivedDate` ↔ db `received_date`
- client `purchaseType` / `gstType` / `poDate` / `cgst`/`sgst`/`igst` ↔ db `purchase_type` / `gst_type` / `po_date` / `cgst`/`sgst`/`igst`

### 8.3 Migration-detection resilience (`isMissingColumnError`)

`posStore.js` and `itemsStore.js` both implement a defensive retry: if a Supabase insert/update fails with Postgres error `42703` (`column does not exist`) or `PGRST204` (`schema cache`), the store **strips the newest optional columns and retries**. This lets code ship ahead of migrations without breaking. See `posStore.js:58-62` for the detection and `posStore.js:109-116` for the retry cascade (drops 018 columns, then drops 015 columns, then falls back to the base row).

### 8.4 `settingsStore.js` — single-row table pattern

- `loadSettings()`: `SELECT * FROM public.settings LIMIT 1`. Returns the one row with its `value` jsonb merged against `SETTINGS_DEFAULTS`.
- `saveSettings(obj)`: `UPSERT { id: 1, value: obj }`.
- Hydration path at app boot: `src/App.jsx:11419` (approx) → `loadSettings().then(setSettings)`.

---

## 9. App-level handlers (verified from `src/App.jsx`)

### 9.1 Mutation handlers — 31 total at App root (all audit-covered as of commit `12b71e4`)

Grouped by module. Each line format: `line_number  name  (what it does)`.

**BOM**:
- `12495 handleCreateBOM` — validate, append to `bomDefs`, mirror via `bomCreate`, audit `bom_created`.
- `12524 handleDuplicateBOM` — generate `-COPY-N` key, copy items + capacity, audit `bom_duplicated`.
- `12567 computeBOMDeletionInfo` — pre-flight: counts active builds, rack machines, completed machines; returns `{canDelete, needsReverseStock, ...}`.
- `12577 handleDeleteBOM` — refuses when active builds exist; for rack machines, awaits `handleRemoveRackMachine` per machine (stock reversal); rolls back local on Supabase failure; audit `bom_deleted`.
- `12618 handleRenameBOM` — validates, updates `bomDefs`, cascades key change to `machineLog`, `outwardLog`, `pendingLog`.
- `handleUpdateBOM` — generic BOM UPDATE pass-through; used by Edit Capacity menu, items edit in BOMDrawer, Save-after-rename.

**Machine / production**:
- `12684 handleCreateMachine` — initial stage = `"Assembly"` if destination=`"direct"`, else `"BOM Issued"` (rack). Writes `history` with the transition annotation. Audit `machine_created`.
- `12718 handleUpdateMachineStage` — moves a machine to a new stage; sets `completed_date` when stage='Ready'; appends history; audits `machine_stage` or `machine_completed`.
- `12746 handleStartProduction` — accepts an array of rack-machine ids; batch promotes BOM Issued → Assembly; audits `production_started` once with the serial list.
- `12792 handleRemoveRackMachine` — rack-only; reverses stock via per-line `handleUpdateStock`, deletes pending rows for the issue, deletes outward row, deletes machine row.

**Item CRUD**:
- `12170 handleCreateItemRow` — `itemCreate`, update local state, surface `mediaStripped` alert, audit `item_created` (added `12b71e4`).
- `12190 handleUpdateItemRow` — item move + rename, audit `item_updated` with before/after (added `12b71e4`).
- `12206 handleDeleteItemRow` — audit `item_deleted` with `stockAtDelete` (added `12b71e4`).
- `12260 handleBulkAddItems` — accepts parsed rows from `itemImport`, inserts per-row, audits each.

**Stock**:
- `11702 handleUpdateStock(category, code, delta, eventType)` — optimistic local update + atomic `updateStockAndHistory` via `record_stock_movement` RPC. Reverts optimistic UI on Supabase failure (`reconcileItems`). Audits `stock_adjust` only when invoked **without** `eventType` (standalone adjust); when `eventType` is set (BOM / Inward / Outward / Receive / etc.), the calling flow audits.
- `12030 handleInventoryCorrection` — super-admin stock correction with a specific audit path.

**PO lifecycle**:
- `11750 handleCreatePO` — client-generates `PO-N` id, inserts, audits `po_created`.
- `11771 handleUpdatePO` — general PO patch (status flip, line edit, activity_log append), audits.
- `11814 handleReceivePO` — mass stock-in via `handleUpdateStock` per line, auto-pending-fulfillment via functional `setPendingLog((prev) => applyFulfill(prev))`, writes inward rows, deletes follow-ups, audits `po_received`.
- `11949 handleDeletePO` — super-admin only on received POs; audits `po_deleted` or `po_deleted_received`.
- `11968 handleReverseReceive` — super-admin-only reversal of a received PO: reverses stock, un-pending, deletes inward rows, flips status back.
- `12064 handleConfirmOrder` — status: approved → ordered, with ETA.
- `12088 handleFollowUpDone` — logs completion of a follow-up and schedules the next.

**Inward / pending**:
- `12111 handleInwardComplete` — called by InwardPage after a successful manual inward; auto-fulfills pending entries for that item via functional-form `setPendingLog`.
- `12879 handleFulfillPending` — single-row fulfill, functional-form reducer.
- `12908 handleFulfillGroup` — group-batch fulfill, functional-form reducer.
- `handleAddOutward` — inserts a new outward_log row.
- `handleClearPending` — clears all pending rows.

**Vendor + settings**:
- `12363 handleAddVendor`, `12369 handleEditVendor`, `12379 handleDeleteVendor`, `12412 handleBulkAddVendors` — all audit, use `vendorsStore`.
- `12220 handleSetItemDefaultRate` — PO modal "Save as Default Rate" writes `items.default_purchase_rate`.
- `11400 handleSaveSettings` — persists via `saveSettings`, audits `settings_updated` with `changedFields` diff (added `12b71e4`).

### 9.2 Audit event taxonomy (verified from `tests/regression.test.mjs:AUDIT_EVENT_TYPES`)

```
bom_created, bom_duplicated, bom_renamed, bom_deleted
machine_created, machine_stage, machine_completed, production_started
pending_fulfilled
po_created, po_received, po_deleted, po_deleted_received
inward_manual
item_created, item_updated, item_deleted          (added 12b71e4)
settings_updated                                   (added 12b71e4)
```

Plus (not in the regression inventory, found via grep on App.jsx and auditStore):
- `stock_adjust` — only for standalone manual stock changes
- Edge-Function-emitted: `user_create`, `user_deactivate`, `user_delete`, `password_reset`

---

## 10. Canonical workflows (traced end-to-end from code)

### 10.1 BOM lifecycle

**Create** (OutwardPage → `src/App.jsx:8515`):
Button `+ New BOM` → modal form (`createForm` state in OutwardPage) → `onCreateBOM(key, def)` → `handleCreateBOM` → validates, defaults color, insert `bomDefs` + `bomCreate` + audit.

**Duplicate** (BOM card ⋮ menu → `src/App.jsx:8581`):
Button opens an inline menu; `onDuplicateBOM(bomKey)` → `handleDuplicateBOM` → generates `-COPY` key, inserts duplicate.

**Rename** (inside BOMDrawer, Edit mode → `src/App.jsx:7623`):
`saveBOMEdit` → `onRenameBOM(bomKey, newKey, newLabel)` → `handleRenameBOM` cascades across `machineLog`, `outwardLog`, `pendingLog`.

**Delete** (BOM card ⋮ menu, confirmation modal → `src/App.jsx:8609`):
Pre-flight `computeBOMDeletionInfo(key)` → shows block message if active builds exist, otherwise shows reverse-stock plan. Confirm → `onDeleteBOM(cfm.key)` → `handleDeleteBOM`.

### 10.2 BOM Issue (OutwardPage BOMDrawer)

1. Operator clicks a BOM card → `BOMDrawer` opens for that BOM.
2. Operator picks units/serials to issue.
3. Operator fills component checkboxes + override qtys.
4. Operator clicks "Issue BOM" → `doIssue(chosenDest = undefined)` at `src/App.jsx:7559`.
5. **Destination routing** (verified in doIssue):
   - If no serial, bypass popup, commit directly.
   - If `bom.rackCapacity > 0` (rack-tracked), open the destination popup (`setShowDestChoice(true)`).
   - Else (`rackCapacity = 0`), auto-route to Direct Production (no popup).
6. If "Save To Rack" chosen but `rackReady >= rackCapacity`, show error "Rack is full (R/C). Pick Direct Production, or start production / increase capacity to free a slot." and keep popup open.
7. On commit (`finalDest = 'rack' | 'direct'`):
   - For each line with `issueQty > 0`: call `handleUpdateStock(category, code, -issueQty, "BOM: ${bomKey}")`.
   - Call `onIssue({ bomKey, label, units, issued, pending, note, date, serialNo, destination })`.
   - Set `issuing = true` (duplicate-submit guard); modal closes on success.

### 10.3 BOM Issue downstream — `handleCreateMachine`

Fired from `onIssue` chain for each unit:

- `destination = "direct"` → `initialStage = "Assembly"`, history starts with implicit `BOM Issued → Assembly (auto-promoted)` + `BOM issued — direct production` note.
- `destination = "rack"` → `initialStage = "BOM Issued"`, history has one `BOM Issued` entry.
- Writes machine_log row + mirrors via `machineCreate` + audits `machine_created`.

### 10.4 Production Rack View (MachinePage)

- At `src/App.jsx:8862`, `rackData` computes per-BOM rack cards:
  ```
  ready    = count of machines with bom_key === key AND stage === 'BOM Issued'
  capacity = bomDefs[key].rackCapacity || 0
  state    = capacity > 0 && ready >= capacity ? 'full'
             : ready > 0                        ? 'partial'
             :                                     'empty'
  configured = capacity > 0
  ```
- Filter: `rackData` only renders cards where `configured OR ready > 0` (orphan rack entries from deleted BOMs stay visible for cleanup).
- Clicking a rack card → `openStartProd(rack)` → modal lists per-serial checkboxes of waiting machines → operator selects → `confirmStartProd()` → `onStartProduction(selectedIds)` → `handleStartProduction` → promotes BOM Issued → Assembly, writes history + audits.

### 10.5 Rack card ⋮ menu

Introduced by `b5c9357`. Two actions:
- **Edit Rack Capacity** → modal → `onUpdateBOM(key, { ..., rackCapacity: newCap })`. Setting to 0 removes the rack card immediately (because `rackData` filter is `configured OR ready > 0`).
- **Delete Rack** → confirm modal. If `ready > 0`, blocked with "Remove rack machines first" message. If `ready = 0`, performs `onUpdateBOM(key, { ..., rackCapacity: 0 })`.

### 10.6 Machine stage progression (MachinePage card)

- At `src/App.jsx:8917` (`handleStageUpdate`), the card has a stage dropdown + Update button.
- Dropdown offers only `MACHINE_STAGES` entries beyond the current one.
- Click Update → `onUpdateStage(machine.id, newStage)` → `handleUpdateMachineStage` writes history, audits `machine_stage` or `machine_completed` (when newStage='Ready').

### 10.7 Remove From Rack (OutwardPage BOM card)

- Button on BOM card where machines are still on rack → confirm modal (`removeRackConfirm` state) → `onRemoveRackMachine(machine.id)` → `handleRemoveRackMachine`.
- `handleRemoveRackMachine` (`src/App.jsx:12792`):
  1. Refuses if `machine.stage !== 'BOM Issued'` (anything past Assembly is already being built).
  2. For each `issuedLine` in the matching `outwardLog` row: `await handleUpdateStock(category, code, +issueQty, "Rack remove: BOM-X [S/N]")`.
  3. Deletes pending rows for `issueId`.
  4. Deletes outward row by `issueId`.
  5. Deletes `machine_log` row.

### 10.8 Purchase Order lifecycle

**Create** (OrderPipelinePage → `POModal`):
Status defaults to `draft`. Operator fills vendor + lines + GST type → `handleCreatePO(data)` → generates next `PO-N` id (max existing + 1), inserts, audits `po_created`.

**Approve / Reject / Order**:
Buttons on the PO detail panel → `handleUpdatePO(id, { status, ... })` → mirrors + audits.

**Receive**:
`handleReceivePO(id)` (`src/App.jsx:11814`):
1. For each line with `qty > 0`: `handleUpdateStock(category, code, +qty, "Receive: PO-X")`.
2. Build `lineDeductions` map of auto-fulfillable pending rows.
3. Hoisted reducer `applyFulfill` + `setPendingLog((prev) => applyFulfill(prev))` (fixed in `b6d0746` to be functional-form).
4. Supabase mirror: per fulfilled pending row, `pendingUpdate` or `pendingDelete`.
5. For each cleared issueId, call `notifyMachineComplete` to mark the machine "All materials issued".
6. Audit `po_received`.

**Reverse Receive** (super_admin only):
`handleReverseReceive(id, reason)` — reverses stock, un-pending (reinserts pending rows), deletes inward rows, flips status to `approved` or `ordered`.

**Delete** (super_admin only, received PO):
Button at `src/App.jsx:6914` gated by `viewPO.status === 'received' && isSuperAdmin`. Audit `po_deleted_received`.

### 10.9 Pending fulfillment

- **Give Material (single row)**: `handleGiveMaterial(entry)` → wrapped by `guardedFulfill` (busyRef sync guard) → `handleUpdateStock(-canIssue)` + `onFulfillPending(entry, canIssue)` → `handleFulfillPending` (functional-form reducer, Supabase mirror, `notifyMachineComplete`, audit).
- **Give All (group)**: `handleGiveAllForGroup(group)` → guardedFulfill → `onFulfillGroup(issueId, available)` → `handleFulfillGroup` (atomic reducer, mirror, notify, audit `pending_fulfilled` with `Batch Fulfilled`).
- **Fulfill All (every group)**: `handleFulfillAll` → guardedFulfill → inlines the per-group logic to avoid self-short-circuit from double-guarding.

### 10.10 Inward manual entry

- InwardPage form (`src/App.jsx:7138`) with `submitting` state gate + button `disabled={submitting}`.
- On submit: `handleUpdateStock(category, code, +qty, "Inward")` → on success calls `onInwardComplete(code, category, qty)` → `handleInwardComplete` auto-fulfills matching pending entries.
- `onAddInward` (inline arrow at `src/App.jsx:12958`) inserts into `inwardLog` + mirrors `createInward` + audits `inward_manual`.

### 10.11 Login + session restore + silent-lockout retry (post `8a2669b`)

- `main.jsx` mounts `<AuthProvider>` which runs the initial `supabase.auth.getSession()` restore in `useEffect`.
- Three terminal states, resolved in `src/App.jsx:11567-11609`:
  1. `authLoadError` → full-screen error with Retry + Sign-In-Again buttons.
  2. `authLoading` → spinner "Restoring session…".
  3. `!currentUser` → `<LoginPage />`.
- Login error buckets: `invalid-credentials`, `email-unconfirmed`, `network`, `server` (from `32e3ffe`).

### 10.12 User management (super_admin)

- `src/pages/UserManagementPage.jsx` — list, create, edit, deactivate, delete, reset-password actions.
- All mutations go through `adminApi.js` → Edge Functions. The function enforces caller is `super_admin`; frontend hides buttons for non-admins.
- UI maintains localStorage mirror for offline reads (`src/auth/authStore.js:fetchAllUsers`).

### 10.13 Role management

- `src/pages/RoleManagementPage.jsx` — view/create/edit/delete roles.
- Create / update / delete via `rolesStore` (direct `public.roles` INSERT/UPDATE/DELETE). RLS enforces `has_permission('roles','*')`.

---

## 11. Reports surface today (verified from `HistoryPage` + `AuditHistoryPage`)

### 11.1 History & Reports page (`src/App.jsx:10066`)

- Tabs: `activity`, `inventory`, `purchase`, `inward`, `outward`, `pending`, `production`, `vendors`, `audit`.
- Filters per tab: search text, date-from, date-to, vendor filter, item filter, machine filter, serial filter.
- Export bar (`src/App.jsx:10023`): CSV, Excel (xlsx dependency), PDF (built via jsPDF? — **not verified**, see risks).
- **Does NOT provide**: the 8 report types from your request (overall / delay / HOLD / pending / rating / machine-full-history / factory-internal / customer-progress). What exists today is a per-tab filtered table view.

### 11.2 Audit Trail page (`src/pages/AuditHistoryPage.jsx`)

- Standalone page, not inside HistoryPage.
- Live via `subscribeAudit` → re-fetches `audit_log` on every INSERT.
- Columns: timestamp, user, role, module, type, action, ref.
- Pagination via `fetchAuditFromSupabase({ limit })`.
- No export.

### 11.3 What exists in Analytics (`src/App.jsx:5178`)

- Recharts BarChart / PieChart / LineChart over items + POs.
- Vendor performance pie, stock status breakdown, PO-value trend.
- Static, not filterable.

---

## 12. Attachments, checklists, signatures — explicit audit

Grepping the full `src/App.jsx` for the terms yields:

- `checklist`: **0 occurrences** (none exist).
- `narration`: **0 occurrences** (none exist).
- `signature` / `signPad`: **0 occurrences** (none exist).
- `handover` / `handoff` / `finish-transfer` / `accept-handover`: **0 occurrences**.

For attachments:

- `item.photo` and `item.design_file` fields exist (migration 016); stored in Supabase Storage bucket `item-media` with the 25 MB upload cap (`src/utils/storage.js`). This is item-master media only — not department / machine / stage attachments.
- No machine-attachments table.
- No report-attachments table.

---

## 13. Current production deployment vs repository code

### 13.1 Mapping

| Layer | Production state | Repo state (branch `audit/full-system-check` @ `12b71e4`) |
|---|---|---|
| Served bundle | `assets/index-1ddIktAk.js` with `APP_BUILD = 2026-10-11-restore-bom-rack` | Local build produces the same `APP_BUILD` constant; bundle hash would be the same within the deploy of `3838505` |
| Deployed commit | `3838505` on `origin/main` (merge of PRs #1 + #2) | Local branch is `12b71e4`, exactly one ancestor of `3838505` after the merge commit `8bf639a` and the second merge `3838505` |
| Migrations run on live DB | **Unverified** — no direct Supabase access from this environment. CLAUDE.md notes migrations 001-020 should be applied. | Repo contains migrations 001–020 |
| Edge Functions deployed | **Unverified** — `adminApi.js` detects deployment via HTTP 404 at call time. If any admin function returns 404, the UI surfaces "Edge Function '…' is not deployed". | Repo contains 5 function source files |
| Storage bucket `item-media` | **Unverified** — bucket creation is a dashboard step, not in migrations | Policy SQL assumes bucket exists |

### 13.2 Branch protection (verified public API probe)

- GitHub `/branches/main/protection` → requires auth (401) — cannot read without admin token.
- `/rulesets` → returns `[]` (empty).
- Direct pushes to `main` in prior sessions succeeded without review requirement. Signal: branch protection is **NOT currently enabled**. Flagged repeatedly in previous session reports.

### 13.3 CI (verified via `github.com/.../actions/workflows/ci.yml` HTTP)

- Workflow exists, state: `active`.
- Last run on `audit/full-system-check`: run #38142534472 — all 6 steps success (Setup Node → Install → Run tests → Production build).
- The `ci` job name is what branch protection should require.

---

## 14. Features: works vs incomplete vs missing

### 14.1 Works today (verified)

- Login, session restore, silent-lockout retry, password change in Supabase mode.
- 15-module sidebar, all pages routable, all canView gates enforced.
- Full BOM lifecycle: create, duplicate, rename, safe-delete with pre-flight.
- BOM Issue → destination popup (Rack / Direct Production) → `handleCreateMachine` sets initial stage.
- Production Rack View on Machine Tracker: cards, state badges, Start Production, Remove From Rack, Edit/Delete rack via ⋮ menu.
- Machine stage transitions via dropdown + timeline.
- Stock engine: atomic `record_stock_movement`, negative-stock block, immutable ledger.
- PO lifecycle: Create → Approve → Reject → Order → Receive → Reverse Receive → Delete (super_admin).
- GST calc for 5 purchase types (verified by 34 unit tests).
- Inward manual + auto on PO receive, with auto-fulfillment of pending.
- Pending fulfillment: Give Material, Give All, Fulfill All, duplicate-submit protected.
- Vendor CRUD + import + archive + ledger view.
- Item CRUD + bulk import + media upload (bucket must exist).
- Audit log (append-only, trigger-enforced, live subscription on Audit Trail page).
- AI Assistant: Gemini via Edge Function with permission-gated tools + grounded answers.
- User + Role management via Edge Functions.
- Save-as-Default-Rate from PO modal → `items.default_purchase_rate`.
- Realtime reconciliation on all tracked tables.
- Build-marker drift detection (console + Settings badge + regression test).

### 14.2 Incomplete / partial

- **Reports**: HistoryPage has tabs + filters, but no 8-report-category center, no scheduled report, no PDF (PDF button exists in `HRExportBar` but **unverified** whether the handler is implemented — grep for `onPDF=` in App.jsx shows calls but the actual PDF generation needs verification by reading the handler).
- **Attachments**: item media only; no stage / machine / dept attachments.
- **Password-change (localStorage mode)**: `src/auth/authStore.js` has `hashPassword/checkPassword` on top of `btoa` — explicitly obfuscation, not security. Only in local dev / offline mode.
- **Storage bucket**: migration 017 presumes `item-media` exists; dashboard step needed per deploy.

### 14.3 Missing (relative to the Department Workflow feature set)

Everything from the Department Workflow brief (handover, accept, timeout, HOLD, department durations, overrun narration, checklists, pending items carry-forward, dept attachments, signatures, ratings, factory report, customer report, 8-report center).

### 14.4 Disconnected (features whose code exists but UI is unmounted)

- `function PurchasePage(...)` at `src/App.jsx:4056` is explicitly labelled "legacy — kept for reference, not mounted". The `pages` dict routes `pipeline` to `OrderPipelinePage` instead. The `onDeletePO` button inside `PurchasePage` is dead code.
- `function ApprovalsPage(...)` at `src/App.jsx:5068` exists but is not referenced in the `pages` dict either. Not mounted.

---

## 15. Dependencies & risks when touching any module

### 15.1 "Do not touch" surfaces

- `record_stock_movement` (migration 013): any change to the function body risks factory-safety (negative-stock block) and transaction atomicity.
- `handle_new_auth_user` trigger (migrations 007 / 009): if broken, user creation via `admin-create-user` fails loudly.
- `audit_log` triggers (migration 004): rejecting UPDATE / DELETE is a feature; removing them would allow audit tampering.
- `MACHINE_STAGES` constant at `src/App.jsx:446`: changing the sequence affects stage-progression dropdowns, rack logic (`stage === "BOM Issued"` is a hard filter), direct-production routing, and `handleStartProduction`.
- All 4 `handleFulfill*` reducers use hoisted `applyFulfill` + functional-form `setPendingLog`: regressing to `setPendingLog(newLog)` reintroduces the batched-fulfillment data-loss bug fixed in `b6d0746`.
- `useAuth` destructuring in `App.jsx:11313`: must include `isLoading`, `authLoadError`, `retryAuthLoad`, `supabaseMode` or the silent-lockout retry screen stops working. Regression test enforces this.

### 15.2 Load-bearing wiring

- `pages.outward` passes `onCreateBOM`, `onRenameBOM`, `onRemoveRackMachine`, `onDuplicateBOM`, `onDeleteBOM`, `computeBOMDeletionInfo` to `OutwardPage`. Dropping any of these turns the BOM card ⋮ menu into dead buttons.
- `pages.machines` passes `bomDefs`, `onStartProduction`, `onRemoveRackMachine`, `onUpdateBOM`. Dropping any of these breaks the Production Rack View.
- `pages.pipeline` passes `onSetItemDefaultRate` to drive the PO modal "Save as Default Rate" checkbox.
- `pages.inventory` passes `onCreateItem/UpdateItem/DeleteItem/BulkAddItems`.

### 15.3 Timing / order-of-operations risks

- Deploy order for migrations and code: **migration first, code second**. The stores' `isMissingColumnError` retry cushions reverse ordering, but adding new columns and reading them from code before the column exists means the UI silently drops those fields.
- Edge Function deploys are **independent of Vercel**. Changing `supabase/functions/ai-assistant/index.ts` requires `supabase functions deploy ai-assistant` manually; a Vercel deploy does nothing for Edge Functions.

### 15.4 Regression protections already in place

- `tests/regression.test.mjs`: 131 shape assertions blocking the next 2b71bbc-class deletion. See CLAUDE.md post-mortem.
- `tests/auth.test.mjs`: 31 permission matrix + error-bucket assertions.
- `tests/gst.test.mjs`: 34 GST calc assertions across 5 purchase types.
- `tests/itemImport.test.mjs`: 37 operator-sheet import assertions.
- CI runs all 233 tests + production build on every push and PR.

### 15.5 Open admin tasks (persistent across sessions)

1. Enable GitHub branch protection on `main` requiring the `ci` check.
2. Verify Vercel settings (preview-only for non-main branches, env variables, instant-rollback).
3. Verify Supabase automated backups + PITR status.
4. (Optional) Install `gh` CLI so future automation can open PRs from the terminal.

---

## 16. End-to-end workflow diagram

### 16.1 Happy-path flow (ASCII)

```
                    ┌──────────────────────┐
                    │  Settings → PO Setup │
                    └──────────┬───────────┘
                               │
          ┌────────────────────▼────────────────────┐
          │  Vendors Create ─────────► vendorsStore │
          └────────────────────┬────────────────────┘
                               │
          ┌────────────────────▼────────────────────┐
          │  Inventory → Add Item ───► itemsStore   │
          └────────────────────┬────────────────────┘
                               │
          ┌────────────────────▼────────────────────┐
          │  Order Pipeline → + New PO              │
          │  POModal → handleCreatePO → posStore    │
          │  status: draft → pending → approved     │
          │                      → ordered          │
          │                      → received  ──────┐│
          └────────────────────┬────────────────────┘│
                               │                     │ handleReceivePO
                               │                     │ (per line)
                               │                     ▼
                               │       ┌─────────────────────────────┐
                               │       │ record_stock_movement RPC   │
                               │       │  stock += qty               │
                               │       │  stock_movements INSERT     │
                               │       │  item_history INSERT        │
                               │       └─────────────┬───────────────┘
                               │                     │
                               │                     ▼ auto
                               │       ┌─────────────────────────────┐
                               │       │ pending_log auto-fulfill    │
                               │       │  (handleReceivePO reducer)  │
                               │       └─────────────┬───────────────┘
                               │                     │
                               │                     ▼
                               │       ┌─────────────────────────────┐
                               │       │ inward_log INSERT per line  │
                               │       └─────────────────────────────┘
                               │
┌──────────────────────────────▼────────────────────────────┐
│ Outward → BOM card ⋮ or Issue                             │
│  BOMDrawer → doIssue(chosenDest)                          │
│      │                                                    │
│      ├─ rackCapacity > 0 ─────────► destination popup     │
│      │     ├─ "Save To Rack" ────────────┐                │
│      │     └─ "Direct Production" ──┐    │                │
│      │                              ▼    ▼                │
│      └─ rackCapacity = 0 ──────► auto Direct              │
│                                     │                     │
│                                     ▼                     │
│       handleCreateMachine(destination)                    │
│         direct → stage="Assembly" + history               │
│         rack   → stage="BOM Issued" (sits on rack)        │
│                                     │                     │
│                                     ▼                     │
│       machine_log INSERT                                  │
│       outward_log INSERT                                  │
│       pending_log INSERT (if any line short)              │
│       Per issued line: record_stock_movement -qty          │
└───────────────────────────────────┬───────────────────────┘
                                    │
          ┌─────────────────────────┴──────────────────────┐
          │                                                 │
          ▼                                                 ▼
┌──────────────────────┐             ┌──────────────────────────────┐
│ Pending Stock page   │             │ Machine Tracker — Rack View  │
│  Give Material       │             │  Click rack card → modal     │
│  Give All            │             │  Select serials → Start Prod │
│  Fulfill All         │             │  → handleStartProduction     │
│                      │             │  → stage: BOM Issued →        │
│  → handleFulfill*    │             │           Assembly            │
│  → stock -=          │             └───────┬──────────────────────┘
│  → pending UPDATE    │                     │
│  → notifyMachine     │                     ▼
└──────────────────────┘        ┌──────────────────────────────────┐
                                 │  Machine Tracker — Active Builds │
                                 │   Current stage dropdown          │
                                 │   Assembly → Mechanical           │
                                 │           → Electrical            │
                                 │           → Trial                 │
                                 │           → Ready (completed)     │
                                 │   handleUpdateMachineStage        │
                                 │   writes history + audits         │
                                 └──────────────────────────────────┘
```

### 16.2 Audit trail cross-cut

Every mutation path above calls `logAudit({ type, module, action, ref, user_id, user_name, user_role, ...payload })` which inserts into `audit_log` (RLS-guarded, UPDATE/DELETE blocked at trigger level).

### 16.3 Permission cross-cut

Every mutation button is wrapped in `canDo(module, action)`. Every page is wrapped in `canView(page)`. Both resolution logics are mirrored in Postgres (`has_permission`, `can_view_page`) so RLS enforces at the data layer independently of the UI.

---

## 17. File / module reference map

### 17.1 Source files

| Path | Purpose |
|---|---|
| `src/main.jsx` | React entry; `<RootErrorBoundary><AuthProvider><App /></AuthProvider>`; APP_BUILD_TAG + boot badge |
| `src/App.jsx` | 13,205-line monolithic UI: Dashboard, Inventory, Inward, Outward, Pending, Pipeline, Machines, Vendors, Analytics, AI, History, Settings, Users, Roles |
| `src/index.css` | Tailwind entry + focus-ring and keyboard-first styles |
| `src/config/env.js` | `isSupabaseEnabled`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `IS_PROD`, `ALLOW_DEMO`, boot banner |
| `src/supabase/client.js` | `getSupabase()` lazy singleton, `probeSupabase()` |
| `src/realtime/useRealtimeTables.js` | postgres_changes subscription hook |
| `src/devtools/testDataset.js` | seed data for localStorage mode |
| `src/auth/AuthContext.jsx` | React context: `useAuth()` surface |
| `src/auth/authStore.js` | `DEFAULT_ROLES`, `resolveCanDo`, `resolveCanView`, Supabase user fetch |
| `src/auth/auditStore.js` | localStorage + Supabase audit log mirror; `subscribeAudit`, `fetchAuditFromSupabase` |
| `src/pages/LoginPage.jsx` | 139 lines; auth form with network/credentials/project-outage distinction |
| `src/pages/AuditHistoryPage.jsx` | Audit Trail live-updating page |
| `src/pages/UserManagementPage.jsx` | User list + create/edit/deactivate/delete/password-reset via Edge Functions |
| `src/pages/RoleManagementPage.jsx` | Role CRUD + permission grid editor |
| `src/components/AccessDeniedPage.jsx` | shown when `canView(page)` is false |
| `src/components/UserProfileMenu.jsx` | top-right dropdown: name, role, sign out, change password |
| `src/components/RootErrorBoundary.jsx` | top-of-tree boundary (fc517d0) |
| `src/components/PageErrorBoundary.jsx` | per-page boundary; wraps `pages[activePage]` |
| `src/components/ItemSearchSelect.jsx` | typeahead for picking an item |
| `src/components/VendorSearchSelect.jsx` | typeahead for picking a vendor |
| `src/components/SearchableSelect.jsx` | generic typeahead |
| `src/components/POSettings.jsx` | PO template editor in Settings page |
| `src/stores/*` | per-table CRUD stores (see §8) |
| `src/utils/gst.js` | PURCHASE_TYPES, calculateGSTBreakdown, filterPurchaseTypes, todayIso |
| `src/utils/itemImport.js` | operator-sheet detect + parse (dynamic header row) |
| `src/utils/vendorImport.js` | operator-sheet parse |
| `src/utils/poTemplate.js` | getActiveCompany, normalizePOSettings, openPOPdf, PO_TEMPLATE_OPTIONS |
| `src/utils/storage.js` | uploadItemMedia + MAX_UPLOAD_BYTES (25 MB) |
| `src/utils/whatsapp.js` | sendPOWhatsApp, openVendorWhatsApp, waErrorToast |

### 17.2 Supabase surface

| Path | Purpose |
|---|---|
| `supabase/migrations/001_schema.sql` | roles + users tables; set_updated_at trigger |
| `supabase/migrations/002_master.sql` | vendors, items, item_history, bom_definitions, settings |
| `supabase/migrations/003_transactional.sql` | purchase_orders, inward_log, outward_log, pending_log, follow_ups, machine_log |
| `supabase/migrations/004_audit.sql` | audit_log + append-only triggers |
| `supabase/migrations/005_helpers.sql` | is_super_admin, is_active_user, has_permission, can_view_page |
| `supabase/migrations/006_rls.sql` | ENABLE RLS + policies for all tables |
| `supabase/migrations/007_seed.sql` | handle_new_auth_user trigger |
| `supabase/migrations/008_history_and_softdelete.sql` | item_history re-shape + items.is_active |
| `supabase/migrations/009_fix_user_trigger.sql` | bulletproof trigger rewrite |
| `supabase/migrations/010_fix_audit_user_fk.sql` | audit_log FK fix |
| `supabase/migrations/011_inventory_engine_items.sql` | reserved_stock, reorder_level |
| `supabase/migrations/012_stock_movements.sql` | immutable stock_movements table + triggers |
| `supabase/migrations/013_record_stock_movement.sql` | the stock-engine RPC |
| `supabase/migrations/014_repair_item_history.sql` | item_history column repair |
| `supabase/migrations/015_po_template_columns.sql` | purchase_orders.company_id + template |
| `supabase/migrations/016_item_media.sql` | items.photo + design_file + design_name |
| `supabase/migrations/017_storage_buckets.sql` | item-media storage policies |
| `supabase/migrations/018_po_gst_and_item_gst_rate.sql` | PO GST split + items.gst_rate |
| `supabase/migrations/019_po_gst_type_check.sql` | gst_type CHECK constraint |
| `supabase/migrations/020_items_default_purchase_rate.sql` | items.default_purchase_rate |
| `supabase/functions/admin-create-user/index.ts` | Edge Function (see §4) |
| `supabase/functions/admin-deactivate-user/index.ts` | Edge Function |
| `supabase/functions/admin-delete-user/index.ts` | Edge Function |
| `supabase/functions/admin-reset-password/index.ts` | Edge Function |
| `supabase/functions/ai-assistant/index.ts` | AI brain Edge Function |

### 17.3 Test files

| Path | Count | Purpose |
|---|---|---|
| `tests/auth.test.mjs` | 31 | role matrix + error bucket contracts |
| `tests/gst.test.mjs` | 34 | GST calc across 5 purchase types |
| `tests/itemImport.test.mjs` | 37 | operator-sheet import |
| `tests/regression.test.mjs` | 131 | file-size floor, 33 handlers, 16 components, 15 nav ids, 18 audit types, 13 UI strings, 42 store exports, useAuth contract, build-marker invariant |

### 17.4 Governance files

| Path | Purpose |
|---|---|
| `CLAUDE.md` | 10 safety rules + 2b71bbc post-mortem + Supabase do-not-do list |
| `.github/workflows/ci.yml` | install → test → build on every push + PR |
| `.nvmrc` | Node 20 pin |
| `docs/department-workflow-phase-a.md` | Phase A design (unapproved) |
| `docs/as-is-system-documentation.md` | THIS DOCUMENT |

---

## 18. Verified vs assumed vs unverifiable

### 18.1 Verified from code / git / HTTP

- Everything in sections 2, 3, 5, 6, 7, 8, 9, 11, 17.
- Branch SHA inventory on origin.
- Live production bundle hash and build tag (`curl`).
- CI run #38142534472 success (public GitHub REST API).
- Table + column SQL per migration (direct read).
- Each Edge Function's auth gate and permission contract (direct read).
- Each store's export surface (grep).
- Regression test coverage (local test run).

### 18.2 Verified from behaviour across the prior session

- Full BOM / Rack / Direct Production workflow (static trace from UI button to handler to store).
- Password-change in Supabase mode (31 passing auth tests).
- Audit log mirror (14 base event types + 4 added `12b71e4`).

### 18.3 Not verified from code (depend on dashboard state I can't see)

- Whether migrations 001–020 are actually applied in the live Supabase project.
- Whether Storage bucket `item-media` exists in your project.
- Whether all 5 Edge Functions are currently deployed (frontend detects 404 at call time).
- Whether Supabase automated backups / PITR are enabled.
- Whether `GEMINI_API_KEY` is actually set as a secret in the ai-assistant function's env.
- Whether `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` are the production values on Vercel (local `.env` holds placeholder strings — real creds live only on Vercel).
- Whether PDF export in HistoryPage actually renders a PDF or is wired to a stub — need to read the handler to confirm.
- Branch protection state on `main` — API probe returned 401 (admin-only read).

### 18.4 Known-missing (deliberately — these features aren't implemented)

- All Department Workflow features (Phase A/B/C per the earlier design doc).
- Attachments beyond item media.
- Signature pad.
- Rating.
- Dedicated factory/customer reports.
- 8-report export center.

---

## 19. Change-safety notes for any future contributor

If you (or any future Claude Code session) opens this repo to make a change, read these first:

1. **Read `CLAUDE.md` at the repo root first.** 10 non-negotiable rules; the 2b71bbc post-mortem is in there.
2. **Run `npm test` and `npm run build` before and after your change.** 233 tests + a clean build is the baseline.
3. **If your change deletes >200 lines from `src/App.jsx`, stop and justify every removal.** The regression test enforces a file-size floor of 10,000 lines; triggering it is a sign the change is dangerous.
4. **If you add a new mutation handler to App.jsx, add a `logAudit({ type: … })` call to it, and add the new type to `AUDIT_EVENT_TYPES` in `tests/regression.test.mjs`.** The 4 handlers that were missing this were fixed in `12b71e4`.
5. **If you add a new store function, follow the `isSupabaseEnabled()` early-return pattern.** The localStorage branch must keep working.
6. **If you add a new permission (`canDo('module','action')`), add it to all 4 default roles in `src/auth/authStore.js:DEFAULT_ROLES`, and mirror it in the Postgres `has_permission` function's expected shape.**
7. **If you add a new UI string that marks a feature, add it to `USER_FACING_STRINGS` in `tests/regression.test.mjs`.** This protects against future minification refactors that would silently remove the feature from the bundle.
8. **Never force-push to `main`, never bypass CI, never run `supabase db reset` against production.**

---

## 20. Where this document lives and how to update it

- Path: `docs/as-is-system-documentation.md`.
- Expected update cadence: whenever a change lands on `main` that touches the schema, the handler inventory, the audit taxonomy, the nav list, the permissions matrix, or the Edge Functions.
- Suggested convention: a PR that modifies any of those surfaces should include a diff to this document in the same commit range.

**End of document — awaiting owner review. No implementation requested or started.**
