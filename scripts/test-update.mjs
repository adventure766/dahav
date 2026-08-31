/**
 * DAHAV update end-to-end test harness.
 *
 * Creates a sandbox install dir (tests/update-env/sandbox), copies the release
 * zip there as if it were a fresh client install, then drives updater.ps1
 * against a local update-test-server to verify:
 *
 *   1. Fresh install 1.0.0 -> first-run provisioning works
 *   2. Update 1.0.1 applied -> data intact, VERSION updated, health OK
 *   3. Corrupt zip / bad checksum -> rejected, version unchanged
 *   4. Update server unreachable -> still runs
 *   5. Same version -> no update
 *
 * Usage:
 *   node scripts/test-update.mjs
 *
 * The sandbox uses its OWN pb_data (tests/update-env/sandbox/pb_data) and its
 * own ports (8094 for PB, 8091 for the launcher API). It never touches the
 * real project pb_data.
 */
import { spawn } from "node:child_process";
import {
  appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envDir = resolve(root, "tests", "update-env");
const sandbox = resolve(envDir, "sandbox");
const releaseDir = resolve(root, "release");
const zip = resolve(releaseDir, "DAHAV-1.0.0.zip");

const PB_PORT = 8094;
const API_PORT = 8091;
const HEALTH = `http://127.0.0.1:${PB_PORT}/api/dahav/health`;
const API = `http://127.0.0.1:${API_PORT}`;

let failures = 0;
const check = (name, cond, detail = "") => {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name}  ${detail}`); failures++; }
};

async function fetchJson(url, opts, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  } finally {
    clearTimeout(t);
  }
}

async function waitFor(fn, timeoutMs, intervalMs = 700) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await fn()) return true; } catch { /* retry */ }
    await sleep(intervalMs);
  }
  return false;
}

function run(cmd, args, cwd) {
  return new Promise((resolvePromise) => {
    const p = spawn(cmd, args, { cwd, shell: false });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolvePromise({ code, out }));
  });
}

async function unzip(file, dest) {
  // Use PowerShell's Expand-Archive (real-world extraction path).
  await run("powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-Command", `Expand-Archive -Path '${file}' -DestinationPath '${dest}' -Force`,
  ], root);
}

async function waitForPort(port, timeoutMs = 20000) {
  return waitFor(async () => {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/latest.json`, { signal: AbortSignal.timeout(1500) });
      return r.ok || r.status === 404; // server is up even for missing paths
    } catch {
      return false;
    }
  }, timeoutMs, 500);
}

async function main() {
  console.log("\n=== DAHAV update E2E test ===\n");

  // Clean slate: kill any stray sandbox processes from previous runs.
  try {
    await run("powershell", [
      "-NoProfile", "-Command",
      "Get-Process pocketbase,powershell -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*update-env*' } | Stop-Process -Force",
    ], root);
  } catch { /* ignore */ }
  await sleep(800);

  if (!existsSync(zip)) {
    console.error(`Release zip not found: ${zip}\nRun: npm run release`);
    process.exit(1);
  }

  // --- fresh install ------------------------------------------------------
  console.log("1. Fresh install (extract release zip into sandbox)...");
  rmSync(sandbox, { recursive: true, force: true });
  mkdirSync(sandbox, { recursive: true });
  await unzip(zip, sandbox);
  check("sandbox extracted", existsSync(resolve(sandbox, "DAHAV.bat")) && existsSync(resolve(sandbox, "pocketbase.exe")));
  check("no pb_data in release", !existsSync(resolve(sandbox, "pb_data")), "release zip must never contain pb_data");

  // Write a test update-config pointing at the local test server.
  const cfg = {
    manifestUrl: `http://127.0.0.1:8181/latest.json`,
    launcherPort: API_PORT,
    requireSignature: false,
  };
  writeFileSync(resolve(sandbox, "update-config.json"), JSON.stringify(cfg, null, 2));

  // Start the update test server (mode: ok)
  const server = spawn(process.execPath, [resolve(root, "scripts", "update-test-server.mjs")], {
    env: { ...process.env, UPDATE_PORT: "8181", UPDATE_MODE: "ok" }, stdio: "ignore",
  });
  check("update-test-server up", await waitForPort(8181));

  // --- launch updater (first run) ------------------------------------------
  console.log("\n2. First launch (first-run provisioning)...");
  const updater = spawn("powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", resolve(sandbox, "scripts", "updater.ps1"),
    "-ManifestUrl", cfg.manifestUrl, "-LauncherPort", String(API_PORT), "-PbPort", String(PB_PORT), "-NoBrowser", "-TestMode",
  ], { cwd: sandbox, env: { ...process.env, DAHAV_ADMIN_EMAIL: "admin@test.local", DAHAV_ADMIN_PASSWORD: "admin12345", DAHAV_OWNER_EMAIL: "owner@test.local", DAHAV_OWNER_PASSWORD: "owner12345" } });

  const healthy = await waitFor(async () => {
    const r = await fetch(HEALTH).catch(() => null);
    return r?.ok;
  }, 90000);
  check("PocketBase healthy on :8094", !!healthy);

  // Wait for the API listener
  const apiUp = await waitFor(async () => {
    const r = await fetch(`${API}/status`).catch(() => null);
    return r?.ok;
  }, 30000);
  check("launcher API up on :8091", !!apiUp);

  let status = await fetchJson(`${API}/status`);
  check("status.current == 1.0.0", status.body.current === "1.0.0", JSON.stringify(status.body));

  // --- create business data -------------------------------------------------
  console.log("\n3. Create sample business data...");
  // Login as owner
  const login = await fetchJson(`${HEALTH.replace("/api/dahav/health", "/api/collections/users/auth-with-password")}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: "owner@test.local", password: "owner12345" }),
  });
  check("owner login works", login.status === 200, JSON.stringify(login.body).slice(0, 100));
  const token = login.body.token;
  const H = { Authorization: token, "Content-Type": "application/json" };

  const prod = await fetchJson(`http://127.0.0.1:${PB_PORT}/api/collections/products/records`, {
    method: "POST", headers: H,
    body: JSON.stringify({ name: "Test Widget", unit_price: 5, unit_cost: 2, stock: 0, currency: "USD", active: true }),
  });
  check("product created", prod.status === 200);
  const productId = prod.body.id;
  // FIFO inventory: stock must come from a stock-in movement, not a raw field.
  const stockIn = await fetchJson(`http://127.0.0.1:${PB_PORT}/api/dahav/inventory/stock-in`, {
    method: "POST", headers: H,
    body: JSON.stringify({ product_id: productId, quantity: 50, unit_cost: 2 }),
  });
  check("stock-in created", stockIn.status === 200, JSON.stringify(stockIn.body).slice(0, 150));
  const cust = await fetchJson(`http://127.0.0.1:${PB_PORT}/api/collections/customers/records`, {
    method: "POST", headers: H,
    body: JSON.stringify({ name: "Test Customer" }),
  });
  check("customer created", cust.status === 200);

  const customerId = cust.body.id;
  const sale = await fetchJson(`http://127.0.0.1:${PB_PORT}/api/dahav/pos/checkout`, {
    method: "POST", headers: H,
    body: JSON.stringify({
      items: [{ product_id: productId, quantity: 2 }],
      payment_method: "cash", payment_currency: "USD", exchange_rate: 8000,
      tendered: 10, customer_id: customerId,
    }),
  });
  check("sale created", sale.status === 200, JSON.stringify(sale.body).slice(0, 120));

  // --- same-version: no update ------------------------------------------------
  console.log("\n4. Same version -> no update available");
  status = await fetchJson(`${API}/status`);
  check("no update when same version", status.body.hasUpdate === false, JSON.stringify(status.body));

  // --- offline: still works ----------------------------------------------------
  console.log("\n5. Update server unreachable -> app keeps working");
  // Kill the test server, trigger a re-check by restarting launcher? The updater
  // re-checks every 30 min; instead verify the status endpoint still responds and
  // health is fine. Then restart server for the update test.
  server.kill();
  await sleep(800);
  const health2 = await fetch(HEALTH).catch(() => null);
  check("still healthy after server down", health2?.ok === true);
  const status2 = await fetchJson(`${API}/status`);
  check("status still responds", status2.status === 200);

  // --- create a NEW release 1.0.1 ----------------------------------------------
  console.log("\n6. Publish v1.0.1 (corrupt test first)...");

  // Make a fake "new" release: copy current zip + bump VERSION inside a new zip.
  // We'll construct it by copying the existing release zip and editing VERSION
  // via a fresh archive to keep it simple.
  const newZip = resolve(envDir, "DAHAV-1.0.1.zip");
  rmSync(newZip, { force: true });
  await run("powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-Command", `Copy-Item '${zip}' '${newZip}'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::Open('${newZip}','Update'); $e=$z.GetEntry('VERSION'); $s=$e.Open(); $w=New-Object IO.StreamWriter($s); $w.Write('1.0.1'); $w.Dispose(); $s.Dispose(); $z.Dispose()`,
  ], root);

  // Write latest.json for v1.0.1 with CORRECT sha
  const sha = (await run("powershell", ["-NoProfile", "-Command", `(Get-FileHash '${newZip}' -Algorithm SHA256).Hash.ToLower()`], root)).out.trim();
  writeFileSync(resolve(envDir, "latest.json"), JSON.stringify({
    version: "1.0.1",
    date: "2026-09-01",
    notes: "Test update.",
    url: `http://127.0.0.1:8181/DAHAV-1.0.1.zip`,
    sha256: sha,
    min_version: "1.0.0",
  }, null, 2));

  // update-test-server serves from releaseDir by default; point it at envDir
  // by starting it with a cwd hack: we'll just copy latest.json + newZip into releaseDir
  // for the test (releaseDir is gitignored-ish scratch).
  cpSync(resolve(envDir, "latest.json"), resolve(releaseDir, "latest.json"));
  cpSync(newZip, resolve(releaseDir, "DAHAV-1.0.1.zip"));

  // restart test server
  const server2Log = resolve(envDir, "server2.log");
  const server2 = spawn(process.execPath, [resolve(root, "scripts", "update-test-server.mjs")], {
    env: { ...process.env, UPDATE_PORT: "8181", UPDATE_MODE: "ok", UPDATE_VERSION: "1.0.1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server2.stdout.on("data", (d) => appendFileSync(server2Log, d));
  server2.stderr.on("data", (d) => appendFileSync(server2Log, d));
  server2.on("exit", (code) => appendFileSync(server2Log, `\n[server2 exit code=${code}]\n`));
  check("update-test-server2 up", await waitForPort(8181));

  // --- trigger re-check via a restart of the launcher ---------------------------
  console.log("\n7. Restart launcher -> detects v1.0.1, stages it");
  // We can't easily push the 30-min re-check; restart the launcher to force it.
  // (In production the app shows a banner; here we validate the mechanics.)
  updater.kill();
  await sleep(1000);
  // Kill the orphaned sandbox PB so the new launcher takes ownership (it must
  // be able to restart PB during apply).
  await run("powershell", ["-NoProfile", "-Command", "Get-Process pocketbase -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*update-env*' } | Stop-Process -Force"], root);
  await sleep(1200);

  const updater2 = spawn("powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", resolve(sandbox, "scripts", "updater.ps1"),
    "-ManifestUrl", cfg.manifestUrl, "-LauncherPort", String(API_PORT), "-PbPort", String(PB_PORT), "-NoBrowser", "-TestMode",
  ], { cwd: sandbox });
  await waitFor(async () => (await fetch(`${API}/status`).catch(() => null))?.ok, 30000);
  // wait for the launch-time check to finish downloading + verifying (up to 60s)
  const detected = await waitFor(async () => {
    const s = await fetchJson(`${API}/status`);
    return s.body.hasUpdate === true && s.body.latest === "1.0.1";
  }, 60000, 1500);
  check("update detected within timeout", !!detected);

  status = await fetchJson(`${API}/status`);
  check("hasUpdate true after v1.0.1 published", status.body.hasUpdate === true, JSON.stringify(status.body));
  check("latest == 1.0.1", status.body.latest === "1.0.1");
  check("update staged", status.body.staged === true);

  // --- apply --------------------------------------------------------------------
  console.log("\n8. Apply update -> data intact, VERSION 1.0.1");
  const apply = await fetchJson(`${API}/apply`, { method: "POST" }, 120000); // apply can take 30-90s
  check("apply ok", apply.status === 200 && apply.body.ok === true, JSON.stringify(apply.body));
  if (apply.body?.ok === false) {
    // give the launcher time to finish (or rollback) then surface the result
    await waitFor(async () => {
      const s = await fetchJson(`${API}/status`);
      return s.body.applyResult !== null;
    }, 60000, 1500);
  }

  // wait for restart + health
  const healthyAfter = await waitFor(async () => (await fetch(HEALTH).catch(() => null))?.ok, 60000);
  check("healthy after apply", !!healthyAfter);

  const verFile = readFileSync(resolve(sandbox, "VERSION"), "utf8").trim();
  check("VERSION file == 1.0.1", verFile === "1.0.1", `got ${verFile}`);

  // data intact?
  const products = await fetchJson(`http://127.0.0.1:${PB_PORT}/api/collections/products/records?perPage=100`, { headers: H });
  check("products survive update", products.body.items?.some((p) => p.id === productId), JSON.stringify(products.body.items?.map((p) => p.name)));
  const sales = await fetchJson(`http://127.0.0.1:${PB_PORT}/api/collections/sales/records?perPage=100`, { headers: H });
  check("sales survive update", sales.body.items?.length >= 1);

  status = await fetchJson(`${API}/status`);
  check("no more update after apply", status.body.hasUpdate === false, JSON.stringify(status.body));

  // --- corrupt zip test -----------------------------------------------------------
  console.log("\n9. Corrupt download / bad checksum -> rejected");
  // publish v1.0.2 with a corrupt zip
  const corruptZip = resolve(envDir, "DAHAV-1.0.2.zip");
  rmSync(corruptZip, { force: true });
  await run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `Copy-Item '${zip}' '${corruptZip}'`], root);
  const badSha = "f".repeat(64);
  writeFileSync(resolve(envDir, "latest.json"), JSON.stringify({
    version: "1.0.2", date: "2026-09-02", notes: "Corrupt test.",
    url: `http://127.0.0.1:8181/DAHAV-1.0.2.zip`, sha256: badSha, min_version: "1.0.0",
  }, null, 2));
  cpSync(resolve(envDir, "latest.json"), resolve(releaseDir, "latest.json"));
  cpSync(corruptZip, resolve(releaseDir, "DAHAV-1.0.2.zip"));
  server2.kill();
  await sleep(800);
  const server3Log = resolve(envDir, "server3.log");
  const server3 = spawn(process.execPath, [resolve(root, "scripts", "update-test-server.mjs")], {
    env: { ...process.env, UPDATE_PORT: "8181", UPDATE_MODE: "corrupt", UPDATE_VERSION: "1.0.2" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server3.stdout.on("data", (d) => appendFileSync(server3Log, d));
  server3.stderr.on("data", (d) => appendFileSync(server3Log, d));
  server3.on("exit", (code) => appendFileSync(server3Log, `\n[server3 exit code=${code}]\n`));
  check("update-test-server3 up", await waitForPort(8181));

  // restart launcher -> check -> download -> checksum mismatch -> no update
  updater2.kill();
  await sleep(1000);
  await run("powershell", ["-NoProfile", "-Command", "Get-Process pocketbase -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*update-env*' } | Stop-Process -Force"], root);
  await sleep(1200);
  const updater3 = spawn("powershell", [
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", resolve(sandbox, "scripts", "updater.ps1"),
    "-ManifestUrl", cfg.manifestUrl, "-LauncherPort", String(API_PORT), "-PbPort", String(PB_PORT), "-NoBrowser", "-TestMode",
  ], { cwd: sandbox });
  await waitFor(async () => (await fetch(`${API}/status`).catch(() => null))?.ok, 30000);
  // wait for the corrupt download attempt to finish (rejected -> not staged)
  await waitFor(async () => {
    const s = await fetchJson(`${API}/status`);
    return s.body.current === "1.0.1" && (s.body.staged === false || s.body.latest === "1.0.2");
  }, 60000, 1500);
  await sleep(2000);

  status = await fetchJson(`${API}/status`);
  check("corrupt update NOT staged", status.body.staged === false, JSON.stringify(status.body));
  check("version still 1.0.1", status.body.current === "1.0.1");

  const verFile2 = readFileSync(resolve(sandbox, "VERSION"), "utf8").trim();
  check("VERSION unchanged after corrupt update", verFile2 === "1.0.1");

  // --- cleanup --------------------------------------------------------------------
  console.log("\n10. Cleanup");
  updater3.kill();
  server3.kill();
  await sleep(1000);
  try {
    await run("powershell", ["-NoProfile", "-Command", `Get-Process pocketbase -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*update-env*' } | Stop-Process -Force`], root);
  } catch { /* ignore */ }
  // remove scratch files from releaseDir (restore latest.json to 1.0.0)
  rmSync(resolve(releaseDir, "DAHAV-1.0.1.zip"), { force: true });
  rmSync(resolve(releaseDir, "DAHAV-1.0.2.zip"), { force: true });
  const realSha = (await run("powershell", ["-NoProfile", "-Command", `(Get-FileHash '${zip}' -Algorithm SHA256).Hash.ToLower()`], root)).out.trim();
  writeFileSync(resolve(releaseDir, "latest.json"), JSON.stringify({
    version: "1.0.0",
    date: new Date().toISOString().slice(0, 10),
    notes: "DAHAV update.",
    url: `https://github.com/dahav/dahav/releases/download/v1.0.0/DAHAV-1.0.0.zip`,
    sha256: realSha,
    min_version: "1.0.0",
  }, null, 2) + "\n");

  console.log(`\n=== ${failures === 0 ? "ALL TESTS PASSED" : failures + " TEST(S) FAILED"} ===`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
