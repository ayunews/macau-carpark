/*
 * 泊車澳門 service worker
 * 讓網站可以安裝到手機桌面，並在離線時仍能開啟。
 */

const VERSION = "2";
const SHELL_CACHE = `carpark-shell-${VERSION}`;
const DATA_CACHE = `carpark-data-${VERSION}`;
const CDN_CACHE = `carpark-cdn-${VERSION}`;
const ACTIVE_CACHES = new Set([SHELL_CACHE, DATA_CACHE, CDN_CACHE]);

const NETWORK_TIMEOUT = 8000;

const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./billing.js",
  "./favicon.svg",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

// 第三方圖示及地圖程式庫：安裝時先抓一份，手機桌面版第一次開、甚至離線開都有圖示。
const CDN_ASSETS = [
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css",
  "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css",
  "https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js",
  "https://unpkg.com/lucide@0.468.0/dist/umd/lucide.min.js",
];

const CDN_HOSTS = new Set([
  "unpkg.com",
  "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com",
]);

const SCOPE_PATH = new URL(self.registration.scope).pathname;
const INDEX_KEY = new URL("./index.html", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await precacheShell();
      await precacheCdnAssets();
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith("carpark-") && !ACTIVE_CACHES.has(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event));
    return;
  }

  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith("/data/carparks.json")) {
      const key = new Request(`${url.origin}${url.pathname}`, { method: "GET" });
      event.respondWith(networkFirst(event, DATA_CACHE, key));
      return;
    }

    if (url.pathname.startsWith(SCOPE_PATH) || url.pathname === "/") {
      event.respondWith(networkFirst(event, SHELL_CACHE));
    }
    return;
  }

  // Leaflet 及 Lucide 由 CDN 載入，這裡會保存一份，離線時亦能使用。
  if (url.protocol === "https:" && CDN_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event, CDN_CACHE));
  }
});

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.allSettled(
    SHELL_ASSETS.map((asset) => cache.add(new Request(asset, { cache: "reload" }))),
  );
}

async function precacheCdnAssets() {
  const cache = await caches.open(CDN_CACHE);
  await Promise.allSettled(
    CDN_ASSETS.map(async (asset) => {
      try {
        if (await cache.match(asset)) return;
        const response = await fetch(
          new Request(asset, { mode: "no-cors", cache: "reload", credentials: "omit" }),
        );
        if (isCacheable(response)) await cache.put(asset, response);
      } catch {
        // 抓不到就等下一次連線時再經 staleWhileRevalidate 補上。
      }
    }),
  );
}

async function handleNavigation(event) {
  try {
    const response = await fetchWithTimeout(event.request, NETWORK_TIMEOUT);
    if (!response || response.status >= 400) throw new Error("bad response");
    await putInCache(SHELL_CACHE, INDEX_KEY, response.clone());
    return response;
  } catch {
    const cached =
      (await matchCache(SHELL_CACHE, INDEX_KEY)) ||
      (await matchCache(SHELL_CACHE, self.registration.scope));
    return cached || Response.error();
  }
}

async function networkFirst(event, cacheName, key) {
  const cacheKey = key || event.request;

  try {
    const response = await fetchWithTimeout(event.request, NETWORK_TIMEOUT);
    if (!response) throw new Error("offline");
    if (response.status >= 400 && !isCacheable(response)) {
      throw new Error(`status ${response.status}`);
    }
    if (isCacheable(response)) {
      await putInCache(cacheName, cacheKey, response.clone());
    }
    return response;
  } catch {
    const cached = await matchCache(cacheName, cacheKey);
    if (cached) return cached;
    throw new Error("no cached response");
  }
}

async function staleWhileRevalidate(event, cacheName) {
  const { request } = event;
  const cached = await matchCache(cacheName, request);

  const revalidate = fetch(request)
    .then(async (response) => {
      if (isCacheable(response)) {
        await putInCache(cacheName, request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(revalidate);
    return cached;
  }

  // 注意：一定要回傳未交給 cache.put 的原物件，否則部分瀏覽器會回傳已消耗的回應。
  const response = await revalidate;
  if (response) return response;
  throw new Error("no cached response");
}

function isCacheable(response) {
  return response.type === "opaque" || response.status === 200;
}

async function putInCache(cacheName, key, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(key, response);
  } catch {
    // 配額不足或不可快取的回應（例如 opaque redirect）忽略即可。
  }
}

async function matchCache(cacheName, key) {
  try {
    const cache = await caches.open(cacheName);
    return (await cache.match(key)) || null;
  } catch {
    return null;
  }
}

function fetchWithTimeout(request, timeout) {
  if (!timeout) return fetch(request);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(request, { signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
}
