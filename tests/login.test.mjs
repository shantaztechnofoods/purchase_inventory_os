// Login regression guards (2026-10-31 login bug).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root  = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const login = fs.readFileSync(path.join(root, "src/pages/LoginPage.jsx"), "utf8");
const app   = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");

test("login fields are uncontrolled — what is visible is what is submitted", () => {
  // A controlled value={…} disagrees with a browser-autofilled field until the
  // user interacts, which is what broke typing/clearing/Show.
  assert.doesNotMatch(login, /value=\{(username|password)\}/);
  assert.match(login, /userRef\.current\?\.value/);
  assert.match(login, /passRef\.current\?\.value/);
});

test("password is read-only until focused (no autofill on page load), and unlocks on focus/tap", () => {
  assert.match(login, /readOnly=\{pwLocked\}/);
  assert.match(login, /useState\(true\); \/\/ read-only until focused/);
  assert.match(login, /onPointerDown=\{unlockPw\}/);
  assert.match(login, /onFocus=\{\(e\) => \{ unlockPw\(\);/);
});

test("Show/Hide is a non-submitting, labelled toggle bound to the password field", () => {
  assert.match(login, /type="button"[\s\S]{0,200}aria-pressed=\{showPw\}/);
  assert.match(login, /type=\{showPw \? "text" : "password"\}/);
  assert.match(login, /aria-controls="login-password"/);
});

test("autocomplete hints are correct for password managers", () => {
  assert.match(login, /autoComplete="username"/);
  assert.match(login, /autoComplete="current-password"/);
});

test("a failed sign-in keeps the username and clears only the password", () => {
  assert.match(login, /if \(passRef\.current\) passRef\.current\.value = "";/);
  assert.doesNotMatch(login, /userRef\.current\.value = ""/);
});

test("one login screen: signed-out auth errors render LoginPage with a notice, not a second page", () => {
  assert.match(app, /if \(authLoadError && !currentUser && !authLoading\) \{\s*return <LoginPage notice=\{authLoadError\} onRetry=\{retryAuthLoad\} \/>;/);
  // The signed-out error branch must come before the generic error screen.
  const a = app.indexOf("if (authLoadError && !currentUser && !authLoading)");
  const b = app.indexOf("Session couldn't be restored");
  assert.ok(a > 0 && b > a, "signed-out error must be handled on the login screen first");
  assert.equal((app.match(/return <LoginPage\b[^\/]*\/>;/g) || []).length, 2, "LoginPage rendered from exactly two auth-gate branches");
});

test("phone inputs are 16px (no iOS zoom-on-focus)", () => {
  assert.equal((login.match(/text-\[16px\] sm:text-\[13px\]/g) || []).length, 2);
});
