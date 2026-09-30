import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

const files = [
  "index.html",
  "styles.css",
  "app.js",
  "billing.js",
  "favicon.svg",
  "manifest.webmanifest",
  "sw.js",
  "standalone.html",
  "data/carparks.json",
  "README.md",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
];

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

for (const file of files) {
  const source = path.join(ROOT, file);
  const target = path.join(DIST, file);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target);
}

console.log(`Built static site at ${DIST}`);
