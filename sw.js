/*
 * 泊車澳門 service worker
 * 讓網站可以安裝到手機桌面，並在離線時仍能開啟。
 */

const VERSION = "1";
const SHELL_CACHE = `carpark-shell-${VERSION}`;
const DATA_CACHE = `carpark-data-${VERSION}`;
const CDN_CACHE = `carpark-cdn-${VERSION}`;
const ACTIVE_CACHES = new Set([SHELL_CACHE, DATA_CACHE, CDN_CACHE]);

const NAVIGATION_TIMEOUT = 6000;

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
      const cache = await caches.open(SHELL_CACHE);
      await Promise.allSettled(
        SHELL_ASSETS.map((asset) => cache.add(new Request(asset, { cache: "reload" }))),
      );
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

  // Leaflet 及 Lucide 由 CDN 載入，快取一份以便離線開啟。
  if (url.protocol === "https:" && CDN_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event, CDN_CACHE));
  }
});

async function handleNavigation(event) {
  try {
    const response = await fetchWithTimeout(event.request, NAVIGATION_TIMEOUT);
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
    const response = await fetchWithTimeout(event.request, NAVIGATION_TIMEOUT);
    if (!response) throw new Error("offline");
    if (response.type === "opaque" || response.status === 200) {
      await putInCache(cacheName, cacheKey, response.clone());
    }
    if (response.status >= 400 && response.type !== "opaque") {
      throw new Error(`status ${response.status}`);
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
    .then((response) => {
      if (response.type === "opaque" || response.status === 200) {
        return putInCache(cacheName, request, response.clone());
      }
      return null;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(revalidate);
    return cached;
  }

  const response = await revalidate;
  if (response) return response;
  throw new Error("no cached response");
}

async function putInCache(cacheName, key, response) {
  try {
    const cache = await caches.open(cacheName);
    await cache.put(key, response);
  } catch {
    // 配額或不可快取的回應（例如 opaque redirect）忽略即可。
  }
  return response;
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
