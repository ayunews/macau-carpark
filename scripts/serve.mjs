import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4173);
const SYNC_INTERVAL = 5 * 60 * 1000;
let activeSync = null;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function runSync() {
  if (activeSync) return activeSync;

  activeSync = new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/sync-dsat.mjs"], {
      cwd: ROOT,
      stdio: "inherit",
      windowsHide: true,
    });
    child.on("error", (error) => {
      console.warn(`Local sync failed: ${error.message}`);
      activeSync = null;
      resolve(false);
    });
    child.on("exit", (code) => {
      activeSync = null;
      resolve(code === 0);
    });
  });

  return activeSync;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);

    if (pathname === "/api/sync") {
      const ok = await runSync();
      response.writeHead(ok ? 200 : 502, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify({ ok }));
      return;
    }

    const target = path.resolve(ROOT, `.${pathname}`);
    if (!target.startsWith(ROOT)) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    const fileStat = await stat(target);
    if (!fileStat.isFile()) throw new Error("Not a file");

    const content = await readFile(target);
    response.writeHead(200, {
      "Content-Type":
        MIME_TYPES[path.extname(target).toLowerCase()] ||
        "application/octet-stream",
      "Cache-Control": "no-cache",
    });
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Serving ${ROOT} at http://127.0.0.1:${port}`);
  console.log("Official API sync runs at startup, every 5 minutes, and on manual refresh.");
  runSync();
  setInterval(runSync, SYNC_INTERVAL);
});
