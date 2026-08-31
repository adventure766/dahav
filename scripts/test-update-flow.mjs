/**
 * Focused test of the DAHAV updater's ON-DEMAND update discovery (fix #1)
 * and version-comparison status logic (fix #2/#3).
 *
 * The updater derives its install root from $PSScriptRoot, so this harness
 * copies scripts/updater.ps1 + scripts/firstrun.ps1 INTO the temp install and
 * launches them from there. The temp install has VERSION=1.0.0, fake pb_data,
 * and a stub pocketbase.exe. A stub health server on the PB port lets the
 * updater ATTACH (never launches the fake exe).
 *
 * The launch-time check runs while the manifest server is DOWN (offline at
 * boot). Then the manifest server comes up and a /status call must trigger the
 * on-demand check -> hasUpdate:true without a restart.
 */
import { spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import http from "node:http";

const ROOT = resolve(".");
const RELEASE = join(ROOT, "release");
const MANIFEST = JSON.parse(readFileSync(join(RELEASE, "latest.json"), "utf8"));
const LAUNCHER_PORT = 8095;   // updater HTTP API (same as LauncherPort)
const PB_PORT = 8094;         // fake PocketBase health
const MANIFEST_PORT = 8096;   // local latest.json server (separate from launcher)

const tmp = mkdtempSync(join(tmpdir(), "dahav-disc-test-"));
const install = join(tmp, "install");
const pbData = join(install, "pb_data");
mkdirSync(pbData, { recursive: true });
mkdirSync(join(install, "scripts"), { recursive: true });
mkdirSync(join(install, "data"), { recursive: true });

// Fake install
writeFileSync(join(install, "VERSION"), "1.0.0\n");
writeFileSync(join(pbData, "data.db"), "fake db bytes for test\n");
writeFileSync(join(install, "pocketbase.exe"), "not an exe\n");
writeFileSync(join(install, "DAHAV.bat"), "@echo off\n");
writeFileSync(join(install, "update-config.json"), JSON.stringify({ manifestUrl: `http://127.0.0.1:${MANIFEST_PORT}/latest.json`, launcherPort: LAUNCHER_PORT }));
// The updater lives next to the install (PSScriptRoot => install root)
cpSync(join(ROOT, "scripts", "updater.ps1"), join(install, "scripts", "updater.ps1"));
cpSync(join(ROOT, "scripts", "firstrun.ps1"), join(install, "scripts", "firstrun.ps1"));

// Stub health server (updater attaches, never launches the fake exe)
const health = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: true, app: "dahav", version: "stub" }));
});
await new Promise((r) => health.listen(PB_PORT, "127.0.0.1", r));

// Update server starts LATER (offline at boot)
let updateServer;
const startUpdateServer = async () => {
  const zipBytes = readFileSync(join(RELEASE, "DAHAV-1.0.1.zip"));
  updateServer = http.createServer((req, res) => {
    if (req.url === "/latest.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(MANIFEST));
    } else {
      res.writeHead(404); res.end();
    }
  });
  await new Promise((r) => updateServer.listen(MANIFEST_PORT, "127.0.0.1", r));
  console.log(`update server now reachable on :${MANIFEST_PORT}`);
};

// Launch the updater from INSIDE the temp install
const updaterPath = join(install, "scripts", "updater.ps1");
const child = spawn("powershell", [
  "-NoProfile", "-ExecutionPolicy", "Bypass",
  "-File", updaterPath,
  "-ManifestUrl", `http://127.0.0.1:${MANIFEST_PORT}/latest.json`,
  "-LauncherPort", String(LAUNCHER_PORT),
  "-PbPort", String(PB_PORT),
  "-NoBrowser",
], { cwd: install, stdio: ["ignore", "pipe", "pipe"] });

let log = "";
child.stdout.on("data", (d) => (log += d.toString()));
child.stderr.on("data", (d) => (log += d.toString()));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const getJson = async (path) => {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${LAUNCHER_PORT}${path}`);
      if (r.ok) return await r.json();
    } catch {}
    await wait(500);
  }
  return null;
};

// Phase 1: manifest server NOT up. /status must return hasUpdate:false cleanly.
let s1 = null;
for (let i = 0; i < 30 && !s1; i++) { s1 = await getJson("/status"); }
console.log("\n--- Phase 1: offline-at-boot /status ---");
console.log(JSON.stringify({ current: s1?.current, hasUpdate: s1?.hasUpdate, latest: s1?.latest }, null, 2));
const offlineOk = s1 && s1.hasUpdate === false && s1.current === "1.0.0";

// Phase 2: manifest server comes online. /status must trigger on-demand check.
await startUpdateServer();
let s2 = null;
for (let i = 0; i < 60 && !(s2?.hasUpdate); i++) {
  s2 = await getJson("/status");
  if (!s2?.hasUpdate) await wait(1000);
}
console.log("\n--- Phase 2: after on-demand check ---");
console.log(JSON.stringify({ current: s2?.current, latest: s2?.latest, hasUpdate: s2?.hasUpdate, releaseNotes: s2?.releaseNotes }, null, 2));
const onlineOk = s2 && s2.hasUpdate === true && s2.latest === MANIFEST.version && s2.current === "1.0.0";

// pb_data must be untouched
const db = readFileSync(join(pbData, "data.db")).toString();
const dbOk = db.trim() === "fake db bytes for test";

console.log("\n=== RESULTS ===");
console.log(`offline /status clean (hasUpdate:false, current:1.0.0): ${offlineOk ? "PASS" : "FAIL"}`);
console.log(`on-demand check -> hasUpdate:true v${s2?.latest}: ${onlineOk ? "PASS" : "FAIL"}`);
console.log(`releaseNotes surfaced: ${s2?.releaseNotes?.length ? "PASS" : "FAIL"}`);
console.log(`pb_data untouched: ${dbOk ? "PASS" : "FAIL"}`);
console.log("\nlog tail:\n" + log.split("\n").filter(l => /update|Update|VERSION|version/i.test(l)).slice(-14).join("\n"));

child.kill();
await wait(500);
health.close();
if (updateServer) updateServer.close();
rmSync(tmp, { recursive: true, force: true });
process.exit(offlineOk && onlineOk && dbOk ? 0 : 1);
