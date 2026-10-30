// Dates saved by the stores must be the local calendar date, not UTC.
// In India (UTC+5:30) the UTC date is the previous day for anything recorded
// between midnight and 05:30 — and "30 Oct 2026" parsed as local midnight was
// always saved as the 29th. See src/stores/localDate.js.
process.env.TZ = "Asia/Kolkata";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const { localIsoDate } = await import("../src/stores/localDate.js");

test("a date typed as '30 Oct 2026' is saved as the 30th in IST", () => {
  assert.equal(localIsoDate(new Date("30 Oct 2026")), "2026-10-30");
});

test("just after midnight IST is still today, not yesterday", () => {
  // 00:15 IST on 31 Oct = 18:45 UTC on 30 Oct.
  assert.equal(localIsoDate(new Date("2026-10-30T18:45:00Z")), "2026-10-31");
});

test("no store builds a calendar date from toISOString() any more", () => {
  const dir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../src/stores");
  const offenders = fs.readdirSync(dir).filter((f) => f.endsWith(".js") && f !== "localDate.js")
    .filter((f) => /toISOString\(\)\.slice\(0,\s*10\)/.test(fs.readFileSync(path.join(dir, f), "utf8")));
  assert.deepEqual(offenders, []);
});
