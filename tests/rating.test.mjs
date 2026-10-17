// Unit tests for src/utils/ratingLogic.js — pure functions.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeDepartmentRating, formatRatingBadge, summarizeMachineRatings,
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
