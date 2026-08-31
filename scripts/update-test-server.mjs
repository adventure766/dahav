/**
 * DAHAV update test server.
 *
 * A local HTTP server that mimics the update host: serves latest.json and
 * release zips, with modes to simulate failure conditions.
 *
 *   node scripts/update-test-server.mjs [port] [mode]
 *
 * Modes:
 *   ok       - serve release/DAHAV-<v>.zip + release/latest.json normally
 *   corrupt  - serve a corrupted zip (bad bytes)
 *   badhash  - serve latest.json with a wrong sha256
 *   missing  - 404 for everything (update host unreachable)
 *
 * Env:
 *   UPDATE_PORT  (default 8181)
 *   UPDATE_MODE  (default ok)
 *   UPDATE_VERSION (override version served in latest.json)
 */
import { createServer } from "node:http";
import { createReadStream, readFileSync, statSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.UPDATE_PORT || 8181);
const mode = process.env.UPDATE_MODE || "ok";
const releaseDir = resolve(root, "release");

function latestJson() {
  const latest = JSON.parse(readFileSync(resolve(releaseDir, "latest.json"), "utf8"));
  const version = process.env.UPDATE_VERSION || latest.version;
  return {
    ...latest,
    version,
    url: `http://127.0.0.1:${port}/DAHAV-${version}.zip`,
  };
}

const server = createServer((req, res) => {
  // Never crash on aborted client connections (e.g. a download that stops).
  req.on("error", () => {});
  res.on("error", () => {});
  const url = req.url || "/";
  if (mode === "missing") {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
    return;
  }
  if (url === "/latest.json") {
    if (mode === "badhash") {
      const l = latestJson();
      l.sha256 = "0".repeat(64); // deliberately wrong
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(l));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(latestJson()));
    return;
  }
  if (url.endsWith(".zip")) {
    const name = url.slice(1);
    const file = resolve(releaseDir, name);
    if (!existsSync(file)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("zip not found");
      return;
    }
    const stat = statSync(file);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": stat.size,
    });
    if (mode === "corrupt") {
      // Corrupt the stream on the fly: write the real data but with flipped
      // bytes near the middle so the checksum fails.
      const mid = Math.floor(stat.size / 2);
      const head = createReadStream(file, { start: 0, end: mid - 1 });
      const tail = createReadStream(file, { start: mid + 3 });
      head.pipe(res, { end: false });
      head.on("end", () => {
        res.write(Buffer.from([0xff, 0xfe, 0xfd]));
        tail.pipe(res);
      });
    } else {
      pipeline(createReadStream(file), res).catch(() => {});
    }
    return;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("unknown path");
});

function listenWithRetry(srv, port, attempts = 20) {
  return new Promise((resolvePromise) => {
    const tryListen = (n) => {
      srv.once("error", (e) => {
        if (e.code === "EADDRINUSE" && n > 0) {
          setTimeout(() => tryListen(n - 1), 500);
        } else {
          console.error(`[update-test-server] listen error: ${e.message}`);
          process.exit(1);
        }
      });
      srv.listen(port, "127.0.0.1", () => resolvePromise());
    };
    tryListen(attempts);
  });
}

listenWithRetry(server, port).then(() => {
  console.log(`[update-test-server] mode=${mode} http://127.0.0.1:${port}`);
});
