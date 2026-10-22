// Static-shape regression tests for src/App.jsx.
//
// Why this file exists
// --------------------
// On 2026-07-19, commit 2b71bbc ("Fix critical stock/pending bugs; add
// Gemini-backed AI Assistant") silently removed 4,582 lines from
// src/App.jsx — wiping the entire BOM lifecycle, Production Rack View,
// Item CRUD wiring, PO default-rate feature, POSearchCenter, and ~20
// other operational-UI surfaces. The commit message mentioned only an
// ItemDetailModal fix + AI Assistant backend swap. All 102 of the other
// unit tests still passed because they test pure utilities (gst, auth,
// itemImport), not the integration surface in App.jsx. The regressed
// bundle shipped to production and was serving the broken UI for
// 2+ months before anyone noticed.
//
// What this file guards
// ---------------------
// If a change rips out a critical handler, nav item, audit event type,
// user-visible string, or page component from src/App.jsx, THIS SUITE
// FAILS LOUDLY. The CI job then blocks the merge.
//
// If a legitimate rename or refactor needs to update the inventory below,
// the author must update this file in the same PR — the inventory
// doubles as a sanctioned-changes checklist.
//
// Rules
// -----
//  * These are STATIC SHAPE checks (string / regex grep). They do NOT
//    import or evaluate App.jsx — React isn't available in Node.
//  * They catch wholesale deletion, not subtle bugs. Unit tests
//    (auth / gst / itemImport) catch logic bugs; this file catches
//    structural regressions.
//  * Keep the inventory conservative: add an entry only when you want
//    future deletions of that symbol to be blocked.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JSX   = resolve(__dirname, "..", "src", "App.jsx");
const MAIN_JSX  = resolve(__dirname, "..", "src", "main.jsx");
const STORES    = resolve(__dirname, "..", "src", "stores");

function read(path) { return readFileSync(path, "utf8"); }
function has(src, needle) { return src.includes(needle); }

// ─── File-size floor (first line of defense against mass deletion) ──────────

test("regression: src/App.jsx is substantially populated (>= 10,000 lines)", () => {
  const src = read(APP_JSX);
  const lines = src.split("\n").length;
  assert.ok(
    lines >= 10000,
    `src/App.jsx shrank to ${lines} lines — expected >= 10,000. ` +
    `A sudden drop of this size has historically meant accidental ` +
    `wholesale deletion (see 2b71bbc post-mortem in CLAUDE.md).`
  );
});

test("regression: src/App.jsx is not pathologically small on disk (>= 400 KB)", () => {
  const bytes = statSync(APP_JSX).size;
  assert.ok(
    bytes >= 400 * 1024,
    `src/App.jsx is ${bytes} bytes — expected >= 400 KB.`
  );
});

// ─── Top-level App-root handlers (BOM / Rack / Machine / Item / PO) ─────────

const APP_HANDLERS = [
  // BOM lifecycle
  "handleCreateBOM",
  "handleDuplicateBOM",
  "handleRenameBOM",
  "handleDeleteBOM",
  "computeBOMDeletionInfo",
  "handleUpdateBOM",

  // Machine / production flow
  "handleCreateMachine",
  "handleUpdateMachineStage",
  "handleStartProduction",
  "handleRemoveRackMachine",

  // Item CRUD
  "handleCreateItemRow",
  "handleUpdateItemRow",
  "handleDeleteItemRow",
  "handleBulkAddItems",
  "handleUpdateStock",

  // PO lifecycle
  "handleCreatePO",
  "handleUpdatePO",
  "handleReceivePO",
  "handleDeletePO",
  "handleReverseReceive",
  "handleSetItemDefaultRate",

  // Vendor
  "handleAddVendor",
  "handleEditVendor",
  "handleDeleteVendor",
  "handleBulkAddVendors",

  // Inward / Outward / Pending
  "handleAddOutward",
  "handleInwardComplete",
  "handleFulfillPending",
  "handleFulfillGroup",
  "handleClearPending",

  // Settings / audit / followups
  "handleSaveSettings",
  "handleConfirmOrder",
  "handleFollowUpDone",

  // Phase A — Department Workflow
  "handleFinishTransfer",
  "handleAcceptHandover",
  "handleRegisterSignature",
  // Phase B — Checklists / Pending items / Attachments / Ratings
  "handleCreateChecklistTemplate",
  "handleUpdateChecklistTemplate",
  "handleDeleteChecklistTemplate",
  "handleResolvePendingItem",
  "handleUploadAttachment",
  "handleDeleteAttachment",
  "handleOverrideRating",
];

for (const name of APP_HANDLERS) {
  test(`regression: src/App.jsx still defines ${name}`, () => {
    const src = read(APP_JSX);
    const re = new RegExp(`const\\s+${name}\\s*=`);
    assert.ok(
      re.test(src),
      `App.jsx no longer defines ${name}. If this was intentional, ` +
      `remove the entry from APP_HANDLERS in tests/regression.test.mjs.`
    );
  });
}

// ─── Page components ────────────────────────────────────────────────────────

const PAGE_COMPONENTS = [
  "DashboardPage",
  "InventoryPage",
  "InwardPage",
  "OutwardPage",
  "PendingPage",
  "OrderPipelinePage",
  "MachinePage",
  "VendorsPage",
  "AnalyticsPage",
  "AIPage",
  "HistoryPage",
  "SettingsPage",
  "BOMDrawer",
  "ItemDetailModal",
  "POModal",
  "POSearchCenter",

  // Phase A — Signature Pad component (module-scope). Protects against the
  // Finish & Transfer / Accept modals losing their signature capture surface.
  "SignaturePad",
  // Phase B / Phase C
  "AttachmentLink",
  "ChecklistAdminPanel",
  "ReportCenterPage",
  "ReportKPI",
  "ReportTable",
];

for (const name of PAGE_COMPONENTS) {
  test(`regression: src/App.jsx still defines ${name}`, () => {
    const src = read(APP_JSX);
    const re = new RegExp(`function\\s+${name}\\b`);
    assert.ok(re.test(src), `App.jsx no longer defines ${name}.`);
  });
}

// ─── Navigation items (sidebar must list all 15 ERP modules) ────────────────

const NAV_IDS = [
  "dashboard", "inventory", "inward", "outward", "pending",
  "pipeline",  "machines",  "vendors", "analytics",
  "ai", "history", "audit", "settings", "users", "roles",
];

test("regression: sidebar navItems contains all 15 modules", () => {
  const src = read(APP_JSX);
  // Scoped grep: must appear inside the navItems array definition.
  const navBlock = src.match(/const navItems\s*=\s*\[([\s\S]*?)\n\];/);
  assert.ok(navBlock, "navItems array not found in App.jsx");
  for (const id of NAV_IDS) {
    const re = new RegExp(`id:\\s*["']${id}["']`);
    assert.ok(re.test(navBlock[1]), `navItems missing module id="${id}"`);
  }
});

// ─── Audit event types (business-event taxonomy) ────────────────────────────
// These strings travel into Supabase audit_log and into History/Reports.
// Removing one silently drops a whole class of event from the audit trail.

const AUDIT_EVENT_TYPES = [
  "bom_created", "bom_duplicated", "bom_renamed", "bom_deleted",
  "machine_created", "machine_stage", "machine_completed", "production_started",
  "pending_fulfilled",
  "po_created", "po_received", "po_deleted", "po_deleted_received",
  "inward_manual",
  // Added by the full-system-check audit — item master-data mutations and
  // company settings changes now emit audit events too.
  "item_created", "item_updated", "item_deleted",
  "settings_updated",
  // Phase A — Department Workflow handover events.
  "handover_sent", "handover_accepted", "handover_overrun_narrated",
  "signature_registered",
  // Phase B — checklists / pending items / attachments / ratings
  "checklist_template_created", "checklist_template_updated", "checklist_template_deleted",
  "pending_item_raised", "pending_item_resolved",
  "attachment_uploaded", "attachment_deleted",
  "department_rated", "rating_overridden",
  // Migration 028 — BOM-wise reusable checklist submission audit split by stage.
  // Replaces the generic "checklist_submitted" string with three stage-specific
  // event types so Reports can filter the Checklist History tab precisely.
  "checklist_submitted_finish", "checklist_submitted_accept", "checklist_submitted_during_work",
];

for (const type of AUDIT_EVENT_TYPES) {
  test(`regression: audit event type "${type}" still emitted`, () => {
    const src = read(APP_JSX);
    assert.ok(
      has(src, `"${type}"`),
      `Audit event type "${type}" is no longer emitted anywhere in App.jsx.`
    );
  });
}

// ─── User-visible strings (minification-safe markers for live-bundle checks) ─

const USER_FACING_STRINGS = [
  // Rack / destination flow
  "Save To Rack",
  "Direct Production",
  "Production Rack View",
  "Edit Rack Capacity",
  "Delete Rack",
  "Remove From Rack",
  "Rack is full",

  // Pending actions
  "Issue All Available",
  "Give All",
  "Give Material",

  // Inventory
  "Add Stock",
  "Remove Stock",

  // Build marker (keeps post-deploy verification working)
  "APP_BUILD",

  // Phase A — Department Workflow
  "Finish & Transfer",
  "Awaiting accept",
  "Accept into",
  "Department Workflow Settings",
  "Acceptance timeout",
  "Per-department work time limits",
  "Explanation required",
  // Phase B — Checklists / Pending items / Attachments / Ratings
  "Department Checklists",
  "Pending Handover Items",
  "Attachments",
  "Mark resolved",
  "Customer Progress Report",
  // Machine Tracker UX pass
  "Pending Acceptance",
  "Accept Machine",
  "ON HOLD",
  "On HOLD",
  "Add Checklist",
  "Add Question",
  "Save Checklist",
  "Checklist Questions",
  // Easier-ops UX pass (2026-10-19)
  "Overdue",
  "Confirm Acceptance",
  "Transfer rules",
  "Require password re-entry at Accept Machine",
  "⚙️ Settings",
  // Phase C — Report Center
  "Report Center",
  "Delay-wise",
  "HOLD-wise",
  "Pending-wise",
  "Rating-wise",
  "Factory",
  "Save as PDF",
  // Critical Item (migration 026)
  "Critical Item",
  "Outward Input Type",
  "Checkbox Confirmation",
  "Serial Number Entry",
  "Critical Item Confirmation",
  // Dedicated BOM-Outward popup — modal footer + per-unit prompt
  "Confirm Outward",
  "Enter one unique serial number per unit",
  // Pending Stock Confirmation popup (2026-10-20)
  "Pending Stock Confirmation",
  "Confirm & Issue",
  // Department Durations popup (migration 027, 2026-10-20)
  "Department Durations",
  "Save Durations & Continue",
  "Locked after Outward",
  // BOM Checklist Builder (migration 028, 2026-10-21)
  "Department Checklists (optional)",
  "Before Receive",
  "During Work",
  "Before Dispatch",
  "During-Work Checks",
  "Save Checklist",
  "+ Add Step",
  "Must do",
];

for (const s of USER_FACING_STRINGS) {
  test(`regression: user-visible string "${s}" present in App.jsx`, () => {
    const src = read(APP_JSX);
    assert.ok(has(src, s), `User-visible string "${s}" removed from App.jsx.`);
  });
}

// ─── Store exports (persistence API surface) ────────────────────────────────

const STORE_SURFACE = [
  // bomsStore
  { file: "bomsStore.js",    exports: ["fetchBOMs", "createBOM", "updateBOM", "renameBOM", "deleteBOM"] },
  // machinesStore
  { file: "machinesStore.js",exports: ["fetchMachines", "createMachine", "updateMachine", "updateMachineBomKey", "deleteMachine"] },
  // itemsStore
  { file: "itemsStore.js",   exports: ["fetchItems", "createItem", "updateItem", "deleteItem", "updateStockAndHistory", "addItemHistory"] },
  // posStore
  { file: "posStore.js",     exports: ["fetchPOs", "createPO", "updatePO", "deletePO"] },
  // inwardStore
  { file: "inwardStore.js",  exports: ["fetchInward", "createInward", "bulkCreateInward", "deleteInwardByPO"] },
  // outwardStore
  { file: "outwardStore.js", exports: ["fetchOutward", "createOutward", "updateOutwardRef", "deleteOutwardByIssueId"] },
  // pendingStore
  { file: "pendingStore.js", exports: ["fetchPending", "bulkCreatePending", "updatePending", "deletePending", "clearAllPending", "updatePendingBomKey"] },
  // vendorsStore
  { file: "vendorsStore.js", exports: ["listVendors", "createVendor", "updateVendor", "deleteVendor", "archiveVendor", "bulkCreateVendors"] },
  // followupsStore
  { file: "followupsStore.js", exports: ["fetchFollowUps", "createFollowUp", "updateFollowUp", "deleteFollowUpsByPO"] },
  // settingsStore
  { file: "settingsStore.js", exports: ["loadSettings", "saveSettings"] },
  // Phase A stores
  { file: "handoverStore.js",   exports: ["fetchHandovers", "fetchPendingHandovers", "createHandover", "acceptHandover", "cancelHandover"] },
  { file: "signaturesStore.js", exports: ["getMySignature", "saveMySignature", "reauthenticateByPassword"] },
  // Phase B stores
  { file: "checklistsStore.js",   exports: ["fetchTemplates", "createTemplate", "updateTemplate", "deleteTemplate", "fetchResponses", "createResponse"] },
  { file: "pendingItemsStore.js", exports: ["fetchPendingItems", "createPendingItem", "resolvePendingItem"] },
  { file: "attachmentsStore.js",  exports: ["fetchAllAttachments", "fetchAttachmentsForMachine", "uploadAttachment", "signedUrlFor", "deleteAttachment", "inferKind"] },
  { file: "ratingsStore.js",      exports: ["fetchRatings", "createRating", "overrideRating"] },
];

for (const { file, exports: names } of STORE_SURFACE) {
  for (const name of names) {
    test(`regression: ${file} exports ${name}`, () => {
      const src = read(resolve(STORES, file));
      const re = new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${name}\\b`);
      assert.ok(re.test(src), `${file} no longer exports ${name}.`);
    });
  }
}

// ─── Auth imports (prevent silent-lockout regression recurrence) ────────────

test("regression: App.jsx reads full useAuth contract (lockout retry screen)", () => {
  const src = read(APP_JSX);
  // The 8a2669b fix depends on these being destructured from useAuth().
  for (const prop of ["isLoading", "authLoadError", "retryAuthLoad", "supabaseMode"]) {
    assert.ok(has(src, prop), `App.jsx no longer destructures ${prop} from useAuth(); the silent-lockout retry screen will be dead.`);
  }
});

// ─── Build marker invariant (deploys stay observable) ───────────────────────

test("regression: APP_BUILD / APP_BUILD_TAG match (deploy-marker consistency)", () => {
  const app  = read(APP_JSX);
  const main = read(MAIN_JSX);
  const appTag  = app.match(/APP_BUILD\s*=\s*"([^"]+)"/);
  const mainTag = main.match(/APP_BUILD_TAG\s*=\s*"([^"]+)"/);
  assert.ok(appTag,  "APP_BUILD constant missing from App.jsx");
  assert.ok(mainTag, "APP_BUILD_TAG constant missing from main.jsx");
  assert.equal(
    appTag[1], mainTag[1],
    `APP_BUILD ("${appTag[1]}") and APP_BUILD_TAG ("${mainTag[1]}") disagree. ` +
    `Both must be bumped together so Settings badge and console banner stay in sync.`
  );
});
