// Profit Lab — Service Worker
// Cache version — bump this string to force cache refresh
const CACHE = "profit-lab-v1";

// All files to cache on install (app shell)
const SHELL = [
  "./app.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
  "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,600;1,9..144,300&display=swap",
  "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js",
];

// ── Install: cache app shell ──────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => {
        // Cache what we can; don't fail install if external CDNs are unreachable
        return Promise.allSettled(
          SHELL.map((url) => cache.add(url).catch(() => {}))
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ── Activate: delete old caches ───────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch: cache-first for shell, network-first for everything else ───────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only handle GET requests
  if (event.request.method !== "GET") return;

  // Skip chrome-extension and non-http(s) requests
  if (!url.protocol.startsWith("http")) return;

  // For navigation requests (HTML pages) — network first, fall back to cache
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match("./app.html"))
    );
    return;
  }

  // For app shell assets — cache first, then network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          // Only cache valid responses
          if (
            !response ||
            response.status !== 200 ||
            response.type === "error"
          ) {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          // Return nothing for non-critical missing assets
          return new Response("", { status: 408 });
        });
    })
  );
});
