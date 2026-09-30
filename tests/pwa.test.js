import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(ROOT, file), "utf8");

const manifest = JSON.parse(read("manifest.webmanifest"));
const indexHtml = read("index.html");
const sw = read("sw.js");
const app = read("app.js");

function pngSize(file) {
  const buffer = readFileSync(path.join(ROOT, file));
  assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${file} 不是 PNG`);
  return `${buffer.readUInt32BE(16)}x${buffer.readUInt32BE(20)}`;
}

test("manifest describes an installable standalone app", () => {
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.ok(manifest.name && manifest.short_name);
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);

  const purposes = manifest.icons.map((icon) => icon.purpose);
  assert.ok(purposes.includes("any"));
  assert.ok(purposes.includes("maskable"));

  const sizes = new Set();
  for (const icon of manifest.icons) {
    const file = icon.src.replace(/^\.\//, "");
    assert.ok(existsSync(path.join(ROOT, file)), `${file} 不存在`);
    assert.equal(pngSize(file), icon.sizes, `${file} 尺寸與 manifest 不符`);
    sizes.add(icon.sizes);
  }
  assert.ok(sizes.has("192x192") && sizes.has("512x512"));
});

test("index.html links the manifest, icons and mobile web app metadata", () => {
  assert.match(indexHtml, /<link rel="manifest" href="\.\/manifest\.webmanifest" \/>/);
  assert.match(indexHtml, /rel="apple-touch-icon"/);
  assert.match(indexHtml, /name="theme-color"/);
  assert.match(indexHtml, /name="apple-mobile-web-app-capable" content="yes"/);
  assert.match(indexHtml, /name="apple-mobile-web-app-title" content="泊車澳門"/);
  assert.ok(existsSync(path.join(ROOT, "icons/apple-touch-icon.png")));
});

test("service worker precaches every app shell asset", () => {
  const list = sw.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/);
  assert.ok(list, "SHELL_ASSETS 區塊不存在");
  const assets = [...list[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(assets.length >= 8);

  for (const asset of assets) {
    if (asset === "./") continue;
    const file = asset.replace(/^\.\//, "");
    assert.ok(existsSync(path.join(ROOT, file)), `${file} 不存在，無法預快取`);
  }

  assert.ok(assets.includes("./index.html"));
  assert.ok(assets.includes("./sw.js") === false, "service worker 不應預快取自己");
  assert.match(sw, /skipWaiting/);
  assert.match(sw, /clients\.claim/);
  assert.match(sw, /data\/carparks\.json/);
});

test("build ships the PWA files to dist", async () => {
  const { execFileSync } = await import("node:child_process");
  execFileSync(process.execPath, ["scripts/build-site.mjs"], { cwd: ROOT });

  for (const file of [
    "dist/index.html",
    "dist/manifest.webmanifest",
    "dist/sw.js",
    "dist/icons/icon-192.png",
    "dist/icons/icon-512.png",
    "dist/icons/icon-maskable-512.png",
    "dist/icons/apple-touch-icon.png",
  ]) {
    assert.ok(existsSync(path.join(ROOT, file)), `${file} 未輸出到 dist`);
  }
});

test("install button is wired between index.html and app.js", () => {
  assert.match(indexHtml, /id="installButton"/);
  assert.match(app, /installButton: document\.querySelector\("#installButton"\)/);
  assert.match(app, /beforeinstallprompt/);
  assert.match(app, /serviceWorker\.register\("\.\/sw\.js"\)/);
  assert.match(app, /加入主畫面/);
});

test("service worker precaches the CDN icon and map libraries", () => {
  assert.match(sw, /const CDN_ASSETS = \[/);
  assert.match(sw, /lucide@0\.468\.0\/dist\/umd\/lucide\.min\.js/);
  assert.match(sw, /leaflet@1\.9\.4\/dist\/leaflet\.js/);
  assert.match(sw, /leaflet\.markercluster@1\.5\.3\/dist\/leaflet\.markercluster\.js/);
  assert.match(sw, /precacheCdnAssets/);
  assert.match(sw, /if \(await cache\.match\(asset\)\) return;/);
});

test("service worker never returns a response that was handed to cache.put", () => {
  const put = sw.match(/async function putInCache\([\s\S]*?\n\}/);
  assert.ok(put, "putInCache 不存在");
  assert.ok(
    !/return/.test(put[0]),
    "putInCache 不應回傳已交給 cache.put 的回應物件",
  );

  const swr = sw.match(/async function staleWhileRevalidate\([\s\S]*?\n\}/);
  assert.ok(swr, "staleWhileRevalidate 不存在");
  assert.match(swr[0], /await putInCache\(cacheName, request, response\.clone\(\)\)/);
  assert.match(swr[0], /return response;/);
});

test("icon and map libraries have fallback sources", () => {
  assert.match(app, /THIRD_PARTY_FALLBACKS/);
  assert.match(app, /cdn\.jsdelivr\.net\/npm\/lucide@0\.468\.0/);
  assert.match(app, /cdn\.jsdelivr\.net\/npm\/leaflet@1\.9\.4/);
  assert.match(app, /ensureThirdPartyAssets/);
  assert.match(app, /loadFirstAvailableScript/);
  assert.match(indexHtml, /cdn\.jsdelivr\.net\/npm\/leaflet@1\.9\.4\/dist\/leaflet\.css/);
});
