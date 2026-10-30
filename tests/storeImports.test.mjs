// Every store function App.jsx calls must actually be imported.
//
// Found 2026-10-30: App.jsx called releaseHandover() but never imported it.
// The bundle built, every unit test passed, and in production the "Send to
// <dept>" button on a rack-parked machine threw "releaseHandover is not
// defined" — so every machine that finished Assembly stuck on the rack with
// no way off. A build does not catch this (it is a runtime ReferenceError),
// so this test does: it reads each store's exports and fails if App.jsx
// calls one by name without importing or defining it.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const app = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
const storeDir = path.join(root, "src/stores");

const imported = new Set();
for (const m of app.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'][^"']+["']/g)) {
  for (const part of m[1].split(",")) {
    const [orig, alias] = part.trim().split(/\s+as\s+/);
    if (orig) imported.add((alias || orig).trim());
  }
}
const defined = (name) =>
  new RegExp(`(const|let|var|function)\\s+${name}\\b`).test(app)
  // const { name } = await import("./stores/…") — the lazy-loaded stores.
  || new RegExp(`const\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=`).test(app)
  || imported.has(name);

test("App.jsx imports every store function it calls by name", () => {
  const missing = [];
  for (const f of fs.readdirSync(storeDir).filter((x) => x.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(storeDir, f), "utf8");
    for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)) {
      const name = m[1];
      // Called directly (not as obj.name, not inside a dynamic import()).
      const called = new RegExp(`(^|[^.\\w])${name}\\s*\\(`, "m").test(app);
      if (called && !defined(name)) missing.push(`${name} (${f})`);
    }
  }
  assert.deepEqual(missing, [], `Called in App.jsx but never imported: ${missing.join(", ")}`);
});
