// Deploy readiness: wrangler.jsonc matches what the Worker code expects, and only src/ is public.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const readJsonc = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8").replace(/^\s*\/\/.*$/gm, ""));

test("wrangler.jsonc: assets from ./src via the Worker, DailyCap DO with a SQLite migration, no secrets", () => {
  const c = readJsonc("wrangler.jsonc");
  assert.strictEqual(c.main, "worker/index.js");
  assert.deepStrictEqual(c.assets, { directory: "./src", binding: "ASSETS", run_worker_first: true });
  assert.deepStrictEqual(c.durable_objects.bindings, [{ name: "CAP", class_name: "DailyCap" }]);
  assert.deepStrictEqual(c.migrations, [{ tag: "v1", new_sqlite_classes: ["DailyCap"] }]);
  assert.match(c.compatibility_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepStrictEqual(Object.keys(c.vars), ["DAILY_CAP"]);
  for (const k of ["ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", "ACCESS_PASSCODE", "SESSION_SECRET"]) assert.ok(!(k in c.vars), k);
});

test("public assets: src/ holds only the page and its scripts (no secrets, tests, docs or worker code)", () => {
  assert.deepStrictEqual(fs.readdirSync(path.join(ROOT, "src")).sort(), ["app.js", "hosted.js", "index.html", "logic.js", "voice.js"]);
});

test("package.json: wrangler is a devDependency and deploy runs wrangler deploy", () => {
  const p = readJsonc("package.json");
  assert.ok(p.devDependencies && p.devDependencies.wrangler);
  assert.strictEqual(p.scripts.deploy, "wrangler deploy");
  assert.ok(fs.existsSync(path.join(ROOT, "package-lock.json")), "lockfile committed for Workers Builds");
});
