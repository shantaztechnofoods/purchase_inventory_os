// Zero-row write tests for src/stores/*.js
//
// Why this file exists
// --------------------
// PostgREST answers an UPDATE or DELETE that matched ZERO rows with no error
// and no data. Every store here used to be written as:
//
//     const { error } = await c.from("t").update(row).eq("id", id);
//     if (error) return { success: false, error: error.message };
//     return { success: true };
//
// which reports success for a write that touched nothing. Zero rows has two
// real causes in this app: an id that does not exist, and an RLS policy that
// hides the row from the signed-in user. Both were being swallowed.
//
// This cost a confirmed production incident on 2026-10-29: a machine moved
// stage on screen, stayed put in Postgres, and reverted on the next reload
// with nothing in the console. machinesStore.updateMachine / deleteMachine
// were fixed first; this suite covers the rest of the stores and locks in the
// fix so it cannot silently regress.
//
// What it guards
// --------------
//  1. Targeted single-row writes (keyed on a primary key or a unique business
//     key) must report { success: false, noRows: true } when nothing matched.
//  2. Bulk cascade writes (keyed on bom_key / po_id / ref / from_po, or a
//     clear-the-whole-table sweep) must KEEP returning success on zero rows.
//     Zero is the normal outcome there — a BOM with no machines yet, a PO with
//     no follow-ups, an already-empty pending log. Forcing a failure in those
//     would be worse than the original bug, so the deliberate non-change is
//     asserted here rather than left to a future reader's judgement.
//  3. A real PostgREST error still propagates as error.message, unchanged.
//
// How it runs
// -----------
// There is no network in CI, and the stores reach Supabase through
// getSupabase() imported from ../supabase/client.js. So both of the stores'
// only two imports are replaced with node:test module mocks before the stores
// are loaded: isSupabaseEnabled() is forced true (otherwise every function
// returns early down its localStorage branch) and getSupabase() hands back a
// fake query builder whose resolved { data, error } is set per test. The store
// code under test is the real code — only the client is fake.
//
// This needs --experimental-test-module-mocks, which is why package.json runs
// this one file in its own `node --test` invocation.

import { test, mock } from "node:test";
import assert from "node:assert/strict";

// ─── Module mocks (must be installed before the stores are imported) ────────

let CLIENT = null;

mock.module(new URL("../src/config/env.js", import.meta.url).href, {
  namedExports: {
    isSupabaseEnabled: () => true,
    IS_PROD: false,
    SUPABASE_URL: "https://stub.supabase.co",
    SUPABASE_ANON_KEY: "stub-anon-key",
    USE_SUPABASE: true,
    ALLOW_DEMO: false,
    APP_NAME: "test",
    APP_ENV: "test",
  },
});

mock.module(new URL("../src/supabase/client.js", import.meta.url).href, {
  namedExports: {
    getSupabase: () => CLIENT,
    probeSupabase: async () => ({ ok: true }),
  },
});

const bomsStore        = await import("../src/stores/bomsStore.js");
const pendingStore     = await import("../src/stores/pendingStore.js");
const posStore         = await import("../src/stores/posStore.js");
const outwardStore     = await import("../src/stores/outwardStore.js");
const inwardStore      = await import("../src/stores/inwardStore.js");
const followupsStore   = await import("../src/stores/followupsStore.js");
const checklistsStore  = await import("../src/stores/checklistsStore.js");
const ratingsStore     = await import("../src/stores/ratingsStore.js");
const attachmentsStore = await import("../src/stores/attachmentsStore.js");
const machinesStore    = await import("../src/stores/machinesStore.js");

// ─── Fake Supabase client ───────────────────────────────────────────────────
//
// Mimics just enough of the postgrest-js builder: every filter/modifier method
// returns the builder, the builder is thenable, and awaiting it resolves to a
// configurable { data, error }. A chain that included update/delete/insert
// resolves to `write`; a pure read chain resolves to `read`, so the stores
// that read before they write (checklistsStore bumps `version`,
// attachmentsStore looks up `storage_path`) behave realistically.

function fakeClient({ write, read = { data: null, error: null } } = {}) {
  const chains = [];
  const storageRemovals = [];

  function builder(table) {
    const ops = [];
    let isWrite = false;
    const b = {};
    const record = (name) => (...args) => {
      if (name === "update" || name === "delete" || name === "insert" || name === "upsert") isWrite = true;
      ops.push({ op: name, args });
      return b;
    };
    for (const m of ["select", "eq", "neq", "not", "is", "in", "gt", "lt",
                     "order", "limit", "range", "update", "delete", "insert", "upsert"]) {
      b[m] = record(m);
    }
    const settle = () => Promise.resolve(isWrite ? write : read);
    b.single = settle;
    b.maybeSingle = settle;
    b.then = (onOk, onErr) => settle().then(onOk, onErr);
    chains.push({ table, ops, get isWrite() { return isWrite; } });
    return b;
  }

  return {
    from: (table) => builder(table),
    storage: {
      from: () => ({
        remove: async (paths) => { storageRemovals.push(paths); return { data: null, error: null }; },
        createSignedUrl: async () => ({ data: { signedUrl: "https://stub/signed" }, error: null }),
      }),
    },
    __chains: chains,
    __storageRemovals: storageRemovals,
  };
}

// Silence the stores' console chatter but keep it inspectable, so the tests can
// assert the diagnostic the incident needed actually gets logged.
function withCapturedConsole(fn) {
  const real = { info: console.info, warn: console.warn, error: console.error };
  const errors = [];
  console.info = () => {};
  console.warn = () => {};
  console.error = (...a) => { errors.push(a.map(String).join(" ")); };
  try { return fn(errors); } finally { Object.assign(console, real); }
}

async function run(fn, clientOpts) {
  CLIENT = fakeClient(clientOpts);
  const real = { info: console.info, warn: console.warn, error: console.error };
  const errors = [];
  console.info = () => {};
  console.warn = () => {};
  console.error = (...a) => { errors.push(a.map(String).join(" ")); };
  try {
    const result = await fn();
    return { result, errors, client: CLIENT };
  } finally {
    Object.assign(console, real);
    CLIENT = null;
  }
}

// ─── The targeted single-row writes ─────────────────────────────────────────
// Each of these keys on a primary key or a unique business key, so exactly one
// row should match. Zero means "no such row, or RLS hid it" — a failure.

const SINGLE_ROW_WRITES = [
  { label: "bomsStore.updateBOM",                     id: "BOM-A",  call: () => bomsStore.updateBOM("BOM-A", { label: "A", items: [] }) },
  { label: "bomsStore.renameBOM",                     id: "BOM-A",  call: () => bomsStore.renameBOM("BOM-A", "BOM-B", "B") },
  { label: "bomsStore.deleteBOM",                     id: "BOM-A",  call: () => bomsStore.deleteBOM("BOM-A") },
  { label: "pendingStore.updatePending",              id: "p-1",    call: () => pendingStore.updatePending("p-1", { pendingQty: 3 }) },
  { label: "pendingStore.deletePending",              id: "p-1",    call: () => pendingStore.deletePending("p-1") },
  { label: "posStore.updatePO",                       id: "po-1",   call: () => posStore.updatePO("po-1", { status: "Approved" }) },
  { label: "posStore.deletePO",                       id: "po-1",   call: () => posStore.deletePO("po-1") },
  { label: "outwardStore.deleteOutwardByIssueId",     id: "iss-1",  call: () => outwardStore.deleteOutwardByIssueId("iss-1") },
  { label: "followupsStore.updateFollowUp",           id: "f-1",    call: () => followupsStore.updateFollowUp("f-1", { frequency: 7 }) },
  { label: "checklistsStore.updateTemplate",          id: "t-1",    call: () => checklistsStore.updateTemplate("t-1", { name: "Renamed" }) },
  { label: "checklistsStore.deleteTemplate",          id: "t-1",    call: () => checklistsStore.deleteTemplate("t-1") },
  { label: "ratingsStore.overrideRating",             id: "r-1",    call: () => ratingsStore.overrideRating("r-1", { rating: 4, reason: "fixed", overriddenBy: "u-1" }) },
  { label: "attachmentsStore.deleteAttachment",       id: "a-1",    call: () => attachmentsStore.deleteAttachment("a-1") },
  // The two that were fixed first and set the template for the rest. Kept here
  // so a future edit to machinesStore cannot quietly undo the original fix.
  { label: "machinesStore.updateMachine",             id: "m-1",    call: () => machinesStore.updateMachine("m-1", { stage: "Assembly" }) },
  { label: "machinesStore.deleteMachine",             id: "m-1",    call: () => machinesStore.deleteMachine("m-1") },
];

for (const { label, id, call } of SINGLE_ROW_WRITES) {
  test(`${label}: an empty result array is a failure, not a success`, async () => {
    const { result } = await run(call, { write: { data: [], error: null } });
    assert.equal(result.success, false, `${label} reported success for a write that matched no rows`);
    assert.equal(result.noRows, true, `${label} must flag noRows so callers can tell this apart from a network error`);
    assert.equal(typeof result.error, "string");
    assert.ok(result.error.length > 0, `${label} must carry a human-readable reason`);
    assert.ok(
      result.error.includes(String(id)),
      `${label} error should name the row it failed to write (got: ${result.error})`,
    );
    assert.match(
      result.error,
      /not visible to this user/,
      `${label} error should mention RLS as a cause (got: ${result.error})`,
    );
  });

  test(`${label}: a matched row is a success`, async () => {
    const { result } = await run(call, { write: { data: [{ id, key: id }], error: null } });
    assert.equal(result.success, true, `${label} failed on a write that did match a row`);
    assert.notEqual(result.noRows, true);
  });

  test(`${label}: null data with no error is also treated as zero rows`, async () => {
    // PostgREST can answer with null rather than []. Both mean "nothing was
    // written", so neither may be reported as success.
    const { result } = await run(call, { write: { data: null, error: null } });
    assert.equal(result.success, false, `${label} reported success for a null result`);
    assert.equal(result.noRows, true);
  });

  test(`${label}: a real error still propagates unchanged`, async () => {
    const { result } = await run(call, { write: { data: null, error: { message: "connection reset", code: "08006" } } });
    assert.equal(result.success, false);
    assert.equal(result.error, "connection reset", `${label} must not mask a genuine error with the zero-row message`);
    assert.notEqual(result.noRows, true, `${label} must not label a transport error as noRows`);
  });

  test(`${label}: logs the zero-row case to console.error`, async () => {
    // The incident was invisible precisely because nothing was logged.
    const { errors } = await run(call, { write: { data: [], error: null } });
    assert.ok(
      errors.some((e) => /matched no rows/.test(e)),
      `${label} must log "matched no rows" — a silent failure is what caused the 2026-10-29 incident`,
    );
  });
}

// ─── The deliberate non-changes ─────────────────────────────────────────────
// These key on a non-unique column (a BOM rename cascade, a PO-delete cascade)
// or sweep a whole table. Zero rows is the normal, correct outcome: a BOM with
// no machines built against it, a PO that was never received, an already-empty
// pending log. If a future pass "fixes" these the same way, every rename of a
// fresh BOM and most PO deletions start reporting failure — so the decision is
// pinned down here.

const BULK_CASCADES = [
  { label: "machinesStore.updateMachineBomKey", why: "a BOM with no machines yet",        call: () => machinesStore.updateMachineBomKey("BOM-A", "BOM-B", "B") },
  { label: "pendingStore.updatePendingBomKey",  why: "a BOM with no pending entries",     call: () => pendingStore.updatePendingBomKey("BOM-A", "BOM-B", "B") },
  { label: "outwardStore.updateOutwardRef",     why: "a BOM that was never issued",       call: () => outwardStore.updateOutwardRef("BOM-A", "BOM-B", "B") },
  { label: "pendingStore.clearAllPending",      why: "an already-empty pending log",      call: () => pendingStore.clearAllPending() },
  { label: "followupsStore.deleteFollowUpsByPO", why: "a PO with no follow-ups",          call: () => followupsStore.deleteFollowUpsByPO("po-1") },
  { label: "inwardStore.deleteInwardByPO",      why: "a PO that was never received",      call: () => inwardStore.deleteInwardByPO("po-1") },
];

for (const { label, why, call } of BULK_CASCADES) {
  test(`${label}: zero rows stays a success (${why})`, async () => {
    const { result } = await run(call, { write: { data: [], error: null } });
    assert.equal(
      result.success, true,
      `${label} must tolerate zero rows — ${why} legitimately matches nothing`,
    );
    assert.notEqual(result.noRows, true);
  });

  test(`${label}: many rows is a success`, async () => {
    const { result } = await run(call, { write: { data: [{ id: 1 }, { id: 2 }, { id: 3 }], error: null } });
    assert.equal(result.success, true);
  });

  test(`${label}: a real error still fails`, async () => {
    const { result } = await run(call, { write: { data: null, error: { message: "permission denied", code: "42501" } } });
    assert.equal(result.success, false, `${label} must still surface a genuine error`);
    assert.equal(result.error, "permission denied");
  });
}

// ─── Ordering guarantees worth pinning ─────────────────────────────────────

test("every patched single-row write actually asks PostgREST for the row back", async () => {
  // The whole fix rests on .select() being present: without it `data` is null
  // and the zero-row branch could never distinguish a hit from a miss. Assert
  // the select reaches the wire rather than trusting the source text.
  for (const { label, call } of SINGLE_ROW_WRITES) {
    const { client } = await run(call, { write: { data: [{ id: "x", key: "x" }], error: null } });
    const writeChains = client.__chains.filter((c) => c.isWrite);
    assert.ok(writeChains.length > 0, `${label} issued no write chain`);
    for (const chain of writeChains) {
      assert.ok(
        chain.ops.some((o) => o.op === "select"),
        `${label} issued an update/delete with no .select() — the zero-row check cannot work without it`,
      );
    }
  }
});

test("attachmentsStore.deleteAttachment does not delete the file when the row survived", async () => {
  // The row check sits before the storage cleanup on purpose: removing the
  // object while its row is still present would leave a live attachment
  // pointing at nothing.
  const { result, client } = await run(
    () => attachmentsStore.deleteAttachment("a-1"),
    { write: { data: [], error: null }, read: { data: { storage_path: "machine/a-1.pdf" }, error: null } },
  );
  assert.equal(result.success, false);
  assert.equal(result.noRows, true);
  assert.deepEqual(
    client.__storageRemovals, [],
    "storage object was removed even though the attachment row was not deleted",
  );
});

test("attachmentsStore.deleteAttachment does remove the file once the row is gone", async () => {
  const { result, client } = await run(
    () => attachmentsStore.deleteAttachment("a-1"),
    { write: { data: [{ id: "a-1" }], error: null }, read: { data: { storage_path: "machine/a-1.pdf" }, error: null } },
  );
  assert.equal(result.success, true);
  assert.deepEqual(client.__storageRemovals, [["machine/a-1.pdf"]]);
});

test("posStore.updatePO carries .select() through both strip-and-retry tiers", async () => {
  // The retry is the call that actually lands on a pre-018 / pre-015 schema.
  // If it dropped the .select(), unmigrated databases would keep the silent
  // success bug while migrated ones looked fixed.
  let attempt = 0;
  CLIENT = null;
  const real = { info: console.info, warn: console.warn, error: console.error };
  console.info = () => {}; console.warn = () => {}; console.error = () => {};
  const seen = [];
  try {
    CLIENT = {
      from: () => {
        const ops = [];
        const b = {};
        for (const m of ["select", "eq", "update"]) b[m] = (...a) => { ops.push(m); return b; };
        b.then = (ok, err) => {
          attempt += 1;
          seen.push([...ops]);
          // Tier 1 and tier 2 both report a missing column, forcing both retries.
          const res = attempt < 3
            ? { data: null, error: { code: "42703", message: "column does not exist" } }
            : { data: [], error: null };
          return Promise.resolve(res).then(ok, err);
        };
        return b;
      },
    };
    const result = await posStore.updatePO("po-1", { status: "Approved", companyId: "c1", purchaseType: "local" });
    assert.equal(attempt, 3, "expected the initial call plus both strip-and-retry tiers");
    for (const [i, ops] of seen.entries()) {
      assert.ok(ops.includes("select"), `updatePO attempt ${i + 1} issued no .select()`);
      assert.ok(ops.includes("update"), `updatePO attempt ${i + 1} issued no .update()`);
    }
    // Third attempt succeeded at the schema level but matched no rows.
    assert.equal(result.success, false);
    assert.equal(result.noRows, true);
  } finally {
    Object.assign(console, real);
    CLIENT = null;
  }
});

test("checklistsStore.updateTemplate carries .select() through the 028 retry", async () => {
  let writeAttempts = 0;
  const real = { info: console.info, warn: console.warn, error: console.error };
  console.info = () => {}; console.warn = () => {}; console.error = () => {};
  const seen = [];
  try {
    CLIENT = {
      from: () => {
        const ops = [];
        let isWrite = false;
        const b = {};
        for (const m of ["select", "eq", "update"]) {
          b[m] = (...a) => { if (m === "update") isWrite = true; ops.push(m); return b; };
        }
        const settle = () => {
          if (!isWrite) return Promise.resolve({ data: { version: 4 }, error: null });
          writeAttempts += 1;
          seen.push([...ops]);
          return Promise.resolve(writeAttempts === 1
            ? { data: null, error: { code: "PGRST204", message: "could not find the bom_key column" } }
            : { data: [], error: null });
        };
        b.maybeSingle = settle;
        b.single = settle;
        b.then = (ok, err) => settle().then(ok, err);
        return b;
      },
    };
    const result = await checklistsStore.updateTemplate("t-1", { name: "Renamed", bomKey: "BOM-A", stage: "Assembly" });
    assert.equal(writeAttempts, 2, "expected the initial update plus the 028 strip-and-retry");
    for (const [i, ops] of seen.entries()) {
      assert.ok(ops.includes("select"), `updateTemplate write attempt ${i + 1} issued no .select()`);
    }
    assert.equal(result.success, false);
    assert.equal(result.noRows, true);
  } finally {
    Object.assign(console, real);
    CLIENT = null;
  }
});

// ─── Client-missing guard (unchanged behaviour, asserted so it stays) ───────

test("every patched write still fails cleanly when there is no client", async () => {
  for (const { label, call } of SINGLE_ROW_WRITES) {
    CLIENT = null;
    const real = { info: console.info, warn: console.warn, error: console.error };
    console.info = () => {}; console.warn = () => {}; console.error = () => {};
    let result;
    try { result = await call(); } finally { Object.assign(console, real); }
    assert.equal(result.success, false, `${label} should fail when getSupabase() returns null`);
    assert.equal(result.error, "no client", `${label} lost its no-client guard`);
  }
});

// withCapturedConsole is exercised indirectly above; referenced here so the
// helper cannot be dropped as dead code without a test failing.
test("console capture helper restores the real console", () => {
  const before = console.error;
  withCapturedConsole(() => { console.error("swallowed"); });
  assert.equal(console.error, before);
});
