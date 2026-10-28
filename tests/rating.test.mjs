// Unit tests for src/utils/ratingLogic.js — pure functions.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeDepartmentRating, formatRatingBadge, summarizeMachineRatings,
  buildDepartmentScoreboard,
} from "../src/utils/ratingLogic.js";

test("computeDepartmentRating: perfect run → 5 stars, no deductions", () => {
  const r = computeDepartmentRating({ overrunMinutes: 0, heldMinutes: 0, pendingItemsOpen: 0 });
  assert.equal(r.rating, 5);
  assert.deepEqual(r.deductions, []);
  assert.equal(r.base, 5);
});

test("computeDepartmentRating: overrun at finish → −1 star", () => {
  const r = computeDepartmentRating({ overrunMinutes: 90 });
  assert.equal(r.rating, 4);
  assert.equal(r.deductions.length, 1);
  assert.equal(r.deductions[0].reason, "overrun_at_finish");
  assert.equal(r.deductions[0].points, 1);
});

test("computeDepartmentRating: held past timeout → −1 star", () => {
  const r = computeDepartmentRating({ heldMinutes: 30 });
  assert.equal(r.rating, 4);
  assert.equal(r.deductions[0].reason, "held_before_accept");
});

test("computeDepartmentRating: pending items open → −1 star", () => {
  const r = computeDepartmentRating({ pendingItemsOpen: 2 });
  assert.equal(r.rating, 4);
  assert.equal(r.deductions[0].reason, "pending_items_open");
});

test("computeDepartmentRating: all three deductions → 2 stars (5 − 3)", () => {
  const r = computeDepartmentRating({ overrunMinutes: 45, heldMinutes: 10, pendingItemsOpen: 1 });
  assert.equal(r.rating, 2);
  assert.equal(r.deductions.length, 3);
});

test("computeDepartmentRating: never goes below 0", () => {
  // Only three deductions are possible, so this is already handled, but
  // the clamp defends against future rules.
  const r = computeDepartmentRating({ overrunMinutes: 1000, heldMinutes: 1000, pendingItemsOpen: 100 });
  assert.ok(r.rating >= 0 && r.rating <= 5);
});

test("computeDepartmentRating: non-numeric inputs are treated as 0", () => {
  const r = computeDepartmentRating({ overrunMinutes: "bad", heldMinutes: null, pendingItemsOpen: undefined });
  assert.equal(r.rating, 5);
});

test("formatRatingBadge renders ★ and ☆", () => {
  assert.equal(formatRatingBadge(5), "★★★★★");
  assert.equal(formatRatingBadge(3), "★★★☆☆");
  assert.equal(formatRatingBadge(0), "☆☆☆☆☆");
  assert.equal(formatRatingBadge(10), "★★★★★");    // clamp
  assert.equal(formatRatingBadge(-2), "☆☆☆☆☆");    // clamp
});

test("summarizeMachineRatings: empty input → count 0, null average", () => {
  const s = summarizeMachineRatings([]);
  assert.equal(s.count, 0);
  assert.equal(s.average, null);
  assert.deepEqual(s.perDept, {});
});

test("summarizeMachineRatings: averages across departments", () => {
  const s = summarizeMachineRatings([
    { department: "Assembly",   rating: 5, id: 1 },
    { department: "Mechanical", rating: 3, id: 2 },
    { department: "Electrical", rating: 4, id: 3 },
  ]);
  assert.equal(s.count, 3);
  assert.equal(s.average, 4);
  assert.equal(s.perDept.Assembly.rating, 5);
  assert.equal(s.perDept.Mechanical.rating, 3);
});

test("summarizeMachineRatings: keeps latest rating per dept when duplicates", () => {
  const s = summarizeMachineRatings([
    { department: "Mechanical", rating: 2, id: 10 },
    { department: "Mechanical", rating: 5, id: 20 },    // newer
  ]);
  assert.equal(s.perDept.Mechanical.rating, 5);
});

test("summarizeMachineRatings: marks overridden entries", () => {
  const s = summarizeMachineRatings([
    { department: "Trial", rating: 3, id: 7, overriddenBy: "user-123" },
  ]);
  assert.equal(s.perDept.Trial.overridden, true);
});

// ─── buildDepartmentScoreboard ─────────────────────────────────────────────
// "Where it sticks" used to be four CSV-shaped tables; this is the row-per-
// department summary that replaced the arithmetic people were doing in their
// heads. The ownership rule is the part worth pinning: running over is charged
// to the sender, making the next department wait is charged to the receiver.

const HOUR = 60 * 60 * 1000;
const sentAt = (hoursAgo) => new Date(Date.now() - hoursAgo * HOUR).toISOString();

test("buildDepartmentScoreboard: a clean run scores 100% on time, no overrun", () => {
  const rows = buildDepartmentScoreboard([
    { fromDepartment: "Assembly", toDepartment: "Mechanical", overrunMinutes: 0,
      sentAt: sentAt(3), acceptedAt: sentAt(2.5), acceptTimeoutMinutes: 120 },
    { fromDepartment: "Assembly", toDepartment: "Mechanical", overrunMinutes: 0,
      sentAt: sentAt(5), acceptedAt: sentAt(4.8), acceptTimeoutMinutes: 120 },
  ], []);
  const asm = rows.find((r) => r.department === "Assembly");
  assert.equal(asm.handovers, 2);
  assert.equal(asm.onTimePct, 100);
  assert.equal(asm.overran, 0);
  assert.equal(asm.avgOverrun, 0);
});

test("buildDepartmentScoreboard: overrun is charged to the sender", () => {
  const rows = buildDepartmentScoreboard([
    { fromDepartment: "Electrical", toDepartment: "Trial", overrunMinutes: 30,
      sentAt: sentAt(4), acceptedAt: sentAt(3.9), acceptTimeoutMinutes: 120 },
    { fromDepartment: "Electrical", toDepartment: "Trial", overrunMinutes: 90,
      sentAt: sentAt(9), acceptedAt: sentAt(8.9), acceptTimeoutMinutes: 120 },
    { fromDepartment: "Electrical", toDepartment: "Trial", overrunMinutes: 0,
      sentAt: sentAt(12), acceptedAt: sentAt(11.9), acceptTimeoutMinutes: 120 },
  ], []);
  const el = rows.find((r) => r.department === "Electrical");
  assert.equal(el.overran, 2);
  assert.equal(el.avgOverrun, 60);          // (30 + 90) / 2
  assert.equal(el.onTimePct, 33);           // 1 of 3
  // The receiver was prompt every time, so Trial carries no held time.
  const trial = rows.find((r) => r.department === "Trial");
  assert.equal(trial.heldCount, 0);
});

test("buildDepartmentScoreboard: a late accept is charged to the receiver, not the sender", () => {
  const rows = buildDepartmentScoreboard([
    // Sent 5h ago, accepted 1h ago → 4h to accept against a 2h window = 2h held.
    { fromDepartment: "Assembly", toDepartment: "Mechanical", overrunMinutes: 0,
      sentAt: sentAt(5), acceptedAt: sentAt(1), acceptTimeoutMinutes: 120 },
  ], []);
  const asm  = rows.find((r) => r.department === "Assembly");
  const mech = rows.find((r) => r.department === "Mechanical");
  assert.equal(asm.heldCount, 0, "the sender finished on time; the wait is not theirs");
  assert.equal(mech.heldCount, 1);
  assert.equal(mech.avgHeld, 120);          // 240 minutes waited - 120 allowed
});

test("buildDepartmentScoreboard: averages the stars a department was given", () => {
  const rows = buildDepartmentScoreboard(
    [{ fromDepartment: "Mechanical", toDepartment: "Electrical", overrunMinutes: 0,
       sentAt: sentAt(2), acceptedAt: sentAt(1.9), acceptTimeoutMinutes: 120 }],
    [
      { department: "Mechanical", rating: 4 },
      { department: "Mechanical", rating: 3 },
      { department: "Mechanical", rating: 5 },
    ]
  );
  assert.equal(rows.find((r) => r.department === "Mechanical").avgRating, 4);
});

test("buildDepartmentScoreboard: worst first, and no rating sorts last rather than as a zero", () => {
  const rows = buildDepartmentScoreboard(
    [
      { fromDepartment: "Good",  toDepartment: "X", overrunMinutes: 0, sentAt: sentAt(2), acceptedAt: sentAt(1.9), acceptTimeoutMinutes: 120 },
      { fromDepartment: "Bad",   toDepartment: "X", overrunMinutes: 0, sentAt: sentAt(2), acceptedAt: sentAt(1.9), acceptTimeoutMinutes: 120 },
      { fromDepartment: "Unrated", toDepartment: "X", overrunMinutes: 0, sentAt: sentAt(2), acceptedAt: sentAt(1.9), acceptTimeoutMinutes: 120 },
    ],
    [{ department: "Good", rating: 5 }, { department: "Bad", rating: 2 }]
  );
  const order = rows.map((r) => r.department).filter((d) => d !== "X");
  assert.deepEqual(order, ["Bad", "Good", "Unrated"],
    "a department with no stars yet is unknown, not bad — it must not be shown as the worst");
});

test("buildDepartmentScoreboard: survives empty and malformed input", () => {
  assert.deepEqual(buildDepartmentScoreboard([], []), []);
  assert.deepEqual(buildDepartmentScoreboard(undefined, undefined), []);
  // Rows missing a department, and ratings that are not numbers, are skipped
  // rather than creating an "undefined" department or poisoning the average.
  const rows = buildDepartmentScoreboard(
    [null, {}, { fromDepartment: "Assembly", toDepartment: "Mechanical", overrunMinutes: 0, sentAt: sentAt(1), acceptedAt: sentAt(0.9), acceptTimeoutMinutes: 120 }],
    [null, { department: "Assembly", rating: "not a number" }, { rating: 5 }]
  );
  assert.equal(rows.length, 2);
  const asm = rows.find((r) => r.department === "Assembly");
  assert.equal(asm.handovers, 1);
  assert.equal(asm.avgRating, null);
});

test("buildDepartmentScoreboard: a handover still waiting counts its held time from now", () => {
  // status pending, never accepted — sent 6h ago against a 2h window.
  const rows = buildDepartmentScoreboard([
    { fromDepartment: "Assembly", toDepartment: "Mechanical", overrunMinutes: 0,
      sentAt: sentAt(6), acceptedAt: null, acceptTimeoutMinutes: 120, status: "pending" },
  ], []);
  const mech = rows.find((r) => r.department === "Mechanical");
  assert.equal(mech.heldCount, 1);
  assert.ok(mech.avgHeld >= 239 && mech.avgHeld <= 241, `expected ~240, got ${mech.avgHeld}`);
});

test("buildDepartmentScoreboard: stages that aren't departments are left out", () => {
  // A machine ends at "Ready" and starts at "BOM Issued". Neither has people,
  // a clock or a rating, so scoring them would pin two permanently empty rows
  // to the top of a table sorted worst-first.
  const rows = buildDepartmentScoreboard([
    { fromDepartment: "BOM Issued", toDepartment: "Assembly", overrunMinutes: 0,
      sentAt: sentAt(8), acceptedAt: sentAt(7.9), acceptTimeoutMinutes: 120 },
    { fromDepartment: "Trial", toDepartment: "Ready", overrunMinutes: 0,
      sentAt: sentAt(2), acceptedAt: sentAt(1.9), acceptTimeoutMinutes: 120 },
  ], [{ department: "Ready", rating: 1 }]);

  const names = rows.map((r) => r.department);
  assert.ok(!names.includes("Ready"), "Ready is a state, not a department");
  assert.ok(!names.includes("BOM Issued"), "BOM Issued is a state, not a department");
  assert.ok(names.includes("Assembly"));
  assert.ok(names.includes("Trial"));
});
