// Regression tests for the authentication/authorization contract used by the
// Shantaz ERP. These lock down the exact failure modes uncovered by the
// "Purchase PO not opening even with correct credentials" audit:
//
//   - Silent lockout: an authenticated user with an EMPTY roles map (roles fetch
//     failed) must NOT be able to view any page. Historically this was invisible
//     because canView returned false with no error surface; the fix in
//     AuthContext now aborts login/session-restore in that state.
//
//   - Purchase Manager MUST be able to view "pipeline" (Purchase PO).
//   - Store Manager and Production MUST NOT be able to view "pipeline".
//   - super_admin bypasses everything, even with an empty roles map.
//   - Disabled users cannot view anything (guarded by the login path).
//   - Per-user overrides beat role-level pages (both ways).
//
// If any of these assertions ever break, the "Purchase PO not opening"
// regression can recur through the same root cause. Do not weaken.
//
// Run:  node --test tests/auth.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ROLES,
  resolveCanView,
  resolveCanDo,
} from "../src/auth/authStore.js";

// ── Fixtures ───────────────────────────────────────────────────────────────

const superAdmin = { id: "sa1", username: "admin", role: "super_admin", status: "active" };
const adminUser  = { id: "u1",  username: "alice", role: "Admin",             status: "active" };
const purchMgr   = { id: "u2",  username: "bob",   role: "Purchase Manager",  status: "active" };
const storeMgr   = { id: "u3",  username: "carol", role: "Store Manager",     status: "active" };
const production = { id: "u4",  username: "dan",   role: "Production",        status: "active" };
const orphaned   = { id: "u5",  username: "eve",   role: "GhostRole",         status: "active" }; // role not in roles map

// ── super_admin bypass ─────────────────────────────────────────────────────

test("super_admin can view every page, even with empty roles map", () => {
  // This is the intentional escape hatch: if roles fail to load and the user
  // is super_admin, they still get in and can navigate to fix the roles table.
  for (const page of ["dashboard", "pipeline", "vendors", "audit", "settings"]) {
    assert.equal(resolveCanView(superAdmin, {}, page), true, `super_admin should view ${page}`);
  }
});

test("super_admin has every action permission, even with empty roles map", () => {
  assert.equal(resolveCanDo(superAdmin, {}, "pipeline", "create"),  true);
  assert.equal(resolveCanDo(superAdmin, {}, "pipeline", "delete"),  true);
  assert.equal(resolveCanDo(superAdmin, {}, "inventory", "delete"), true);
});

// ── Empty-roles silent-lockout regression ──────────────────────────────────
// These are the exact conditions the AuthContext audit was created to prevent.
// The canView/canDo functions correctly return false here; the AuthContext
// login/session-restore paths refuse to leave a non-super-admin user in this
// state without a visible error.

test("REGRESSION: non-super-admin cannot view ANY page with empty roles map", () => {
  for (const page of ["dashboard", "pipeline", "vendors", "audit", "settings"]) {
    assert.equal(resolveCanView(adminUser, {}, page), false, `Admin should NOT view ${page} when roles={}`);
    assert.equal(resolveCanView(purchMgr,  {}, page), false, `Purchase Manager should NOT view ${page} when roles={}`);
    assert.equal(resolveCanView(storeMgr,  {}, page), false, `Store Manager should NOT view ${page} when roles={}`);
  }
});

test("REGRESSION: non-super-admin cannot do ANY action with empty roles map", () => {
  assert.equal(resolveCanDo(adminUser, {}, "pipeline", "create"), false);
  assert.equal(resolveCanDo(purchMgr,  {}, "pipeline", "create"), false);
  assert.equal(resolveCanDo(storeMgr,  {}, "inventory", "adjust"), false);
});

// ── Purchase PO (pipeline) access — the exact bug's positive/negative cases ─

test("Purchase PO: super_admin can view pipeline", () => {
  assert.equal(resolveCanView(superAdmin, DEFAULT_ROLES, "pipeline"), true);
});

test("Purchase PO: Admin can view pipeline", () => {
  assert.equal(resolveCanView(adminUser, DEFAULT_ROLES, "pipeline"), true);
});

test("Purchase PO: Purchase Manager can view pipeline (positive case for the fixed bug)", () => {
  assert.equal(resolveCanView(purchMgr, DEFAULT_ROLES, "pipeline"), true);
});

test("Purchase PO: Store Manager cannot view pipeline (permission model, not auth bug)", () => {
  assert.equal(resolveCanView(storeMgr, DEFAULT_ROLES, "pipeline"), false);
});

test("Purchase PO: Production cannot view pipeline (permission model, not auth bug)", () => {
  assert.equal(resolveCanView(production, DEFAULT_ROLES, "pipeline"), false);
});

test("Purchase PO actions: Purchase Manager can create/approve/receive but cannot delete", () => {
  assert.equal(resolveCanDo(purchMgr, DEFAULT_ROLES, "pipeline", "create"),  true);
  assert.equal(resolveCanDo(purchMgr, DEFAULT_ROLES, "pipeline", "approve"), true);
  assert.equal(resolveCanDo(purchMgr, DEFAULT_ROLES, "pipeline", "receive"), true);
  assert.equal(resolveCanDo(purchMgr, DEFAULT_ROLES, "pipeline", "delete"),  false);
});

test("Purchase PO actions: Store Manager cannot do ANY pipeline action", () => {
  for (const action of ["create", "approve", "reject", "ordered", "receive", "delete"]) {
    assert.equal(resolveCanDo(storeMgr, DEFAULT_ROLES, "pipeline", action), false);
  }
});

// ── Cross-module regression: fixing Purchase PO must not weaken others ─────

test("Vendors: Admin and Purchase Manager can view; Store Manager and Production cannot", () => {
  assert.equal(resolveCanView(adminUser,  DEFAULT_ROLES, "vendors"), true);
  assert.equal(resolveCanView(purchMgr,   DEFAULT_ROLES, "vendors"), true);
  assert.equal(resolveCanView(storeMgr,   DEFAULT_ROLES, "vendors"), false);
  assert.equal(resolveCanView(production, DEFAULT_ROLES, "vendors"), false);
});

test("Inventory: Admin has all actions; Store Manager can adjust only; Production has none", () => {
  assert.equal(resolveCanDo(adminUser,  DEFAULT_ROLES, "inventory", "add"),    true);
  assert.equal(resolveCanDo(adminUser,  DEFAULT_ROLES, "inventory", "delete"), true);
  assert.equal(resolveCanDo(storeMgr,   DEFAULT_ROLES, "inventory", "adjust"), true);
  assert.equal(resolveCanDo(storeMgr,   DEFAULT_ROLES, "inventory", "add"),    false);
  assert.equal(resolveCanDo(production, DEFAULT_ROLES, "inventory", "add"),    false);
  assert.equal(resolveCanDo(production, DEFAULT_ROLES, "inventory", "adjust"), false);
});

test("Outward: Store Manager and Production can issue BOM; Purchase Manager cannot", () => {
  assert.equal(resolveCanDo(storeMgr,   DEFAULT_ROLES, "outward", "bom"), true);
  assert.equal(resolveCanDo(production, DEFAULT_ROLES, "outward", "bom"), true);
  assert.equal(resolveCanDo(purchMgr,   DEFAULT_ROLES, "outward", "bom"), false);
});

test("Machines: Store Manager and Production can update stage; Purchase Manager cannot", () => {
  assert.equal(resolveCanDo(storeMgr,   DEFAULT_ROLES, "machines", "updateStage"), true);
  assert.equal(resolveCanDo(production, DEFAULT_ROLES, "machines", "updateStage"), true);
  assert.equal(resolveCanDo(purchMgr,   DEFAULT_ROLES, "machines", "updateStage"), false);
});

test("Inward: Admin, Purchase Manager and Store Manager can submit; Production cannot", () => {
  assert.equal(resolveCanDo(adminUser,  DEFAULT_ROLES, "inward", "submit"), true);
  assert.equal(resolveCanDo(purchMgr,   DEFAULT_ROLES, "inward", "submit"), true);
  assert.equal(resolveCanDo(storeMgr,   DEFAULT_ROLES, "inward", "submit"), true);
  assert.equal(resolveCanDo(production, DEFAULT_ROLES, "inward", "submit"), false);
});

// ── Orphaned role-key (role deleted / typo / migration mishap) ─────────────

test("REGRESSION: user assigned a role_key that does not exist gets no access", () => {
  // Historically this was another silent-lockout path — resolveCanView returns
  // false with no error, so the operator sees Access Denied on every module.
  // AuthContext now surfaces "User profile missing" / role-fetch errors, but
  // canView still correctly denies here because the roleConf is undefined.
  assert.equal(resolveCanView(orphaned, DEFAULT_ROLES, "pipeline"), false);
  assert.equal(resolveCanView(orphaned, DEFAULT_ROLES, "dashboard"), false);
  assert.equal(resolveCanDo(orphaned,  DEFAULT_ROLES, "pipeline", "create"), false);
});

// ── Unauthenticated ────────────────────────────────────────────────────────

test("Unauthenticated (null user) has no view and no do", () => {
  assert.equal(resolveCanView(null, DEFAULT_ROLES, "pipeline"), false);
  assert.equal(resolveCanView(null, DEFAULT_ROLES, "dashboard"), false);
  assert.equal(resolveCanDo(null,  DEFAULT_ROLES, "pipeline", "create"), false);
});

// ── Per-user overrides ─────────────────────────────────────────────────────

test("Per-user page override TRUE grants access even if role would deny", () => {
  const promoted = { ...storeMgr, overrides: { pages: { pipeline: true } } };
  assert.equal(resolveCanView(promoted, DEFAULT_ROLES, "pipeline"), true);
});

test("Per-user page override FALSE revokes access even if role would grant", () => {
  const restricted = { ...purchMgr, overrides: { pages: { pipeline: false } } };
  assert.equal(resolveCanView(restricted, DEFAULT_ROLES, "pipeline"), false);
});

test("Per-user action override TRUE grants action even if role would deny", () => {
  const granted = { ...storeMgr, overrides: { actions: { pipeline: { create: true } } } };
  assert.equal(resolveCanDo(granted, DEFAULT_ROLES, "pipeline", "create"), true);
});

test("Per-user action override FALSE revokes action even if role would grant", () => {
  const denied = { ...purchMgr, overrides: { actions: { pipeline: { create: false } } } };
  assert.equal(resolveCanDo(denied, DEFAULT_ROLES, "pipeline", "create"), false);
});

// ── DEFAULT_ROLES contract: pipeline must remain in the right roles ────────
// If a future change accidentally removes "pipeline" from a role's pages list,
// these assertions catch it before it hits production.

test("DEFAULT_ROLES contract: pipeline is in Admin.pages", () => {
  assert.ok(DEFAULT_ROLES.Admin.pages.includes("pipeline"),
    "Admin role must include 'pipeline' in pages — removing it recreates the Purchase PO regression");
});

test("DEFAULT_ROLES contract: pipeline is in Purchase Manager.pages", () => {
  assert.ok(DEFAULT_ROLES["Purchase Manager"].pages.includes("pipeline"),
    "Purchase Manager role must include 'pipeline' in pages — removing it recreates the Purchase PO regression");
});

test("DEFAULT_ROLES contract: pipeline is NOT in Store Manager.pages (by design)", () => {
  assert.ok(!DEFAULT_ROLES["Store Manager"].pages.includes("pipeline"),
    "Store Manager should not have pipeline access per the permission matrix");
});

test("DEFAULT_ROLES contract: pipeline is NOT in Production.pages (by design)", () => {
  assert.ok(!DEFAULT_ROLES.Production.pages.includes("pipeline"),
    "Production should not have pipeline access per the permission matrix");
});

test("DEFAULT_ROLES contract: every role has pipeline actions defined (even if all false)", () => {
  // Prevents an accidental future edit that removes the pipeline action group,
  // which would make resolveCanDo return the fallback (false) with no error —
  // another silent-lockout pattern.
  for (const [key, role] of Object.entries(DEFAULT_ROLES)) {
    assert.ok(role.actions?.pipeline, `role ${key} must define actions.pipeline`);
    for (const action of ["create", "approve", "reject", "ordered", "receive", "delete"]) {
      assert.equal(typeof role.actions.pipeline[action], "boolean",
        `role ${key} must have boolean actions.pipeline.${action}`);
    }
  }
});
