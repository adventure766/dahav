/**
 * DAHAV release builder.
 *
 * npm run release
 *
 * 1. Reads version + update config from package.json / update-config.json.
 * 2. Runs `npm run build` (tsc + vite) and deploys dist -> pb_public.
 * 3. Packages the APPLICATION files into release/DAHAV-<v>.zip:
 *      DAHAV.bat, pocketbase.exe, VERSION, update-config.json,
 *      pb_hooks/, pb_migrations/, pb_public/, scripts/ (updater + firstrun)
 *    NEVER pb_data.
 * 4. Computes the SHA-256 of the zip and writes release/latest.json.
 * 5. Optionally publishes: `gh release create v<v> release/DAHAV-<v>.zip`
 *    and pushes latest.json to the `updates` branch (--publish).
 *
 * Note: pocketbase.exe is a large binary (~50MB); it is intentionally
 * included so the client bundle is self-contained.
 */
import { execSync } from "node:child_process";
import {
  createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync,
  readdirSync, rmSync, statSync, writeFileSync, cpSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = resolve(root, "release");
const distDir = resolve(root, "dist");
const publicDir = resolve(root, "pb_public");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const version = pkg.version;
const config = JSON.parse(readFileSync(resolve(root, "update-config.json"), "utf8"));
const publish = process.argv.includes("--publish");

// --- helpers -----------------------------------------------------------------
function sha256(path) {
  const h = createHash("sha256");
  const data = readFileSync(path);
  h.update(data);
  return h.digest("hex");
}

async function zipDir(srcDir, outZip, { prefix = "" } = {}) {
  // Minimal deterministic zip (store, no compression) using Node's zlib.
  // A proper zip needs central directory entries; we implement the format
  // directly below. Compression via deflateRaw for small gains.
  const files = [];
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir).sort()) {
      const full = resolve(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (statSync(full).isDirectory()) walk(full, relPath);
      else files.push({ relPath, full });
    }
  };
  if (existsSync(srcDir)) walk(srcDir, prefix);

  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const data = readFileSync(f.full);
    // deflate raw (RFC 1951) via zlib with -15 window bits => use createDeflateRaw
    const { deflateRawSync } = await import("node:zlib");
    const comp = deflateRawSync(data, { level: 9 });
    const nameBuf = Buffer.from(f.relPath, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);          // local file header sig
    local.writeUInt16LE(20, 4);                  // version needed
    local.writeUInt16LE(0x0800, 6);              // flags (UTF-8 names)
    local.writeUInt16LE(8, 8);                   // method: deflate
    local.writeUInt16LE(0, 10);                  // mod time
    local.writeUInt16LE(0, 12);                  // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const entry = Buffer.concat([local, nameBuf, comp]);
    chunks.push(entry);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);              // central header sig
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12);
    c.writeUInt16LE(0, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt16LE(0, 30);                      // extra len
    c.writeUInt16LE(0, 32);                      // comment len
    c.writeUInt16LE(0, 34);                      // disk
    c.writeUInt16LE(0, 36);                      // internal attrs
    c.writeUInt32LE(0, 38);                      // external attrs
    c.writeUInt32LE(offset, 42);                 // local header offset
    central.push(Buffer.concat([c, nameBuf]));

    offset += entry.length;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(central.length, 8);
  eocd.writeUInt16LE(central.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);

  const zip = Buffer.concat([...chunks, centralBuf, eocd]);
  writeFileSync(outZip, zip);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// --- main ----------------------------------------------------------------------
console.log(`\nDAHAV release v${version}\n`);

if (!existsSync(distDir)) {
  console.log("dist/ missing — running build first…");
  execSync("npm run build", { stdio: "inherit", cwd: root });
}

console.log("Deploying dist -> pb_public …");
rmSync(publicDir, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });
cpSync(distDir, publicDir, { recursive: true });
writeFileSync(resolve(publicDir, "VERSION"), `${version}\n`, "utf8");

mkdirSync(releaseDir, { recursive: true });

// Stage the app files to zip
const stage = resolve(releaseDir, "_stage");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

for (const item of ["DAHAV.bat", "pocketbase.exe", "pb_hooks", "pb_migrations", "pb_public"]) {
  const src = resolve(root, item);
  if (!existsSync(src)) { console.error(`Missing ${item} — aborting`); process.exit(1); }
  cpSync(src, resolve(stage, item), { recursive: true });
}
mkdirSync(resolve(stage, "scripts"), { recursive: true });
for (const item of ["updater.ps1", "firstrun.ps1"]) {
  cpSync(resolve(root, "scripts", item), resolve(stage, "scripts", item));
}
writeFileSync(resolve(stage, "VERSION"), `${version}\n`, "utf8");
cpSync(resolve(root, "update-config.json"), resolve(stage, "update-config.json"));

const zipPath = resolve(releaseDir, `DAHAV-${version}.zip`);
console.log("Packaging release zip…");
await zipDir(stage, zipPath);
const hash = sha256(zipPath);
const size = statSync(zipPath).size;
console.log(`  ${zipPath}`);
console.log(`  ${(size / 1024 / 1024).toFixed(1)} MB  sha256=${hash}`);

// latest.json
const manifest = {
  version,
  date: new Date().toISOString().slice(0, 10),
  notes: "DAHAV update.",
  url: `https://github.com/${config.releaseOwner}/${config.releaseRepo}/releases/download/v${version}/DAHAV-${version}.zip`,
  sha256: hash,
  min_version: "1.0.0",
};
writeFileSync(resolve(releaseDir, "latest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log("  release/latest.json written.");

// Optional publish
if (publish) {
  console.log("\nPublishing…");
  try {
    execSync(`gh release create v${version} "${zipPath}" --title "DAHAV v${version}" --notes "${manifest.notes}"`, { stdio: "inherit", cwd: root });
    console.log("GitHub release created.");
  } catch (e) {
    console.error("gh release failed:", e.message);
  }
  try {
    // Put latest.json on the `updates` branch (stable raw URL).
    writeFileSync(resolve(root, "latest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
    execSync(`git fetch origin updates`, { stdio: "inherit", cwd: root });
    execSync(`git checkout updates`, { stdio: "inherit", cwd: root });
    execSync(`git add latest.json && git commit -m "release v${version}"`, { stdio: "inherit", cwd: root });
    execSync(`git push origin updates`, { stdio: "inherit", cwd: root });
    execSync(`git checkout -`, { stdio: "ignore", cwd: root });
    console.log("latest.json pushed to updates branch.");
  } catch (e) {
    console.error("updates branch push failed (create the branch first with: git checkout -b updates):", e.message);
  }
}

rmSync(stage, { recursive: true, force: true });
console.log("\nRelease complete. Upload release/DAHAV-<v>.zip and release/latest.json to your update host, or run with --publish to push to GitHub.");
