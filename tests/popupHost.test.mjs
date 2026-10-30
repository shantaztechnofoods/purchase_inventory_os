// The card that hosts Machine Tracker's embedded BOM Outward must never take a
// CSS transform.
//
// Found 2026-10-30: `.section-card:hover` lifts cards with transform. A
// transform makes the card the containing block for position:fixed
// descendants, and every BOM popup (serial number, issue drawer, Edit BOM,
// delete confirm) is rendered inside that card. On hover the "full-screen"
// popup collapsed to the card's 1150x196 box and moved, the pointer left the
// card, the lift dropped, the popup went full-screen again — the whole ERP
// flickered on Open BOM. The build and every other test stayed green, so this
// test pins both halves of the fix.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const css = fs.readFileSync(path.join(root, "src/index.css"), "utf8");

test("Machine Tracker BOM host card carries no-lift", () => {
  const i = app.indexOf("{bomSection && (");
  assert.ok(i > 0, "bomSection block not found in MachinePage");
  const block = app.slice(i, i + 600);
  assert.match(block, /className="section-card no-lift"/,
    "the card wrapping {bomSection} must be `section-card no-lift`");
});

test("no-lift cancels the section-card hover transform", () => {
  assert.match(css, /\.section-card\.no-lift,\s*\n?\s*\.section-card\.no-lift:hover\s*\{\s*transform:\s*none;?\s*\}/,
    "index.css must set transform: none on .section-card.no-lift and its :hover");
});
