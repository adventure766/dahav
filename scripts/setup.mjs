/**
 * DAHAV first-run setup.
 *
 * 1. Applies migrations (fresh PocketBase auto-runs them on first serve).
 * 2. Creates the superuser (admin) from DAHAV_ADMIN_EMAIL / DAHAV_ADMIN_PASSWORD.
 * 3. Creates the initial 'owner' staff user so the app can log in with roles.
 *
 * Usage:
 *   node scripts/setup.mjs
 *   DAHAV_ADMIN_EMAIL=admin@x.com DAHAV_ADMIN_PASSWORD=secret node scripts/setup.mjs
 */
import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PB = path.join(ROOT, process.platform === "win32" ? "pocketbase.exe" : "pocketbase");
const DATA_DIR = path.join(ROOT, "pb_data");
const port = 8093;

function ask(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(query, (a) => { rl.close(); resolve(a); }));
}

async function main() {
  let adminEmail = process.env.DAHAV_ADMIN_EMAIL;
  let adminPassword = process.env.DAHAV_ADMIN_PASSWORD;
  const interactive = !process.env.CI;

  if (!adminEmail) {
    if (interactive) adminEmail = await ask("Superuser email: ");
    else { console.error("DAHAV_ADMIN_EMAIL not set"); process.exit(1); }
  }
  if (!adminPassword) {
    if (interactive) adminPassword = await ask("Superuser password (min 8 chars): ");
    else { console.error("DAHAV_ADMIN_PASSWORD not set"); process.exit(1); }
  }

  const pb = spawn(PB, ["serve", `--http=127.0.0.1:${port}`, "--dir", DATA_DIR], { stdio: "ignore" });
  const base = `http://127.0.0.1:${port}`;

  const waitReady = async () => {
    for (let i = 0; i < 60; i++) {
      try {
        const r = await fetch(`${base}/api/health`);
        if (r.ok) return;
      } catch (e) { /* not up */ }
      await new Promise((res) => setTimeout(res, 500));
    }
    throw new Error("PocketBase did not become ready");
  };

  try {
    await waitReady();
    console.log("PocketBase is ready (migrations applied).");

    // Try to auth as existing superuser; if none, create one via the CLI.
    let adminToken = null;
    const authResp = await fetch(`${base}/api/collections/_superusers/auth-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: adminEmail, password: adminPassword }),
    });
    if (authResp.ok) {
      adminToken = (await authResp.json()).token;
    } else {
      // No superuser yet — create via the PocketBase CLI (kills the temp server).
      pb.kill();
      const { execSync } = await import("node:child_process");
      execSync(`"${PB}" superuser upsert "${adminEmail}" "${adminPassword}" --dir "${DATA_DIR}"`, { stdio: "inherit" });
      // Restart and re-auth
      const pb2 = spawn(PB, ["serve", `--http=127.0.0.1:${port}`, "--dir", DATA_DIR], { stdio: "ignore" });
      await waitReady();
      const auth2 = await fetch(`${base}/api/collections/_superusers/auth-with-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: adminEmail, password: adminPassword }),
      });
      if (auth2.ok) adminToken = (await auth2.json()).token;
      if (!adminToken) throw new Error("Could not authenticate superuser after creation");
    }

    console.log("Superuser ready.");

    // Create initial owner user if none exists
    const usersResp = await fetch(`${base}/api/collections/users/records?perPage=1`, {
      headers: { Authorization: adminToken },
    });
    const users = await usersResp.json();
    if (!users.items || users.items.length === 0) {
      const ownerEmail = process.env.DAHAV_OWNER_EMAIL || "owner@dahav.local";
      const ownerPassword = process.env.DAHAV_OWNER_PASSWORD || "owner12345";
      const create = await fetch(`${base}/api/dahav/users/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: adminToken },
        body: JSON.stringify({ email: ownerEmail, password: ownerPassword, name: "Owner", role: "owner" }),
      });
      if (create.ok) {
        console.log(`Owner user created: ${ownerEmail} / ${ownerPassword}`);
      } else {
        console.log("Owner user creation skipped:", (await create.json()).error);
      }
    } else {
      console.log("Users already exist; skipping owner creation.");
    }

    console.log(`Start DAHAV:  ${PB} serve --http=0.0.0.0:8090`);
    console.log(`Open:         http://<this-computer-ip>:8090`);
  } catch (e) {
    console.error("Setup failed:", e.message);
    process.exitCode = 1;
  } finally {
    try { pb.kill(); } catch (e) { /* already dead */ }
  }
}

main();
