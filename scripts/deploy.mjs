/**
 * DAHAV deploy — copy the built frontend (dist/) into PocketBase's static
 * root (pb_public/) and stamp the app version + update config into pb_public
 * so the served app is self-describing.
 *
 * Usage:
 *   npm run build          # or run this script, which does NOT build for you
 *   npm run deploy         # copies dist -> pb_public
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(root, "dist");
const publicDir = resolve(root, "pb_public");

if (!exists(distDir)) {
  console.error("dist/ not found — run `npm run build` first.");
  process.exit(1);
}

console.log("Clearing pb_public/ ...");
rmSync(publicDir, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });

console.log("Copying dist/* -> pb_public/ ...");
cpSync(distDir, publicDir, { recursive: true });

// Stamp the current app version into the served bundle for display + updates.
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
writeFileSync(resolve(publicDir, "VERSION"), `${pkg.version}\n`, "utf8");
console.log(`pb_public/VERSION -> ${pkg.version}`);

function exists(p) {
  try { readFileSync(p); return true; } catch { return false; }
}
