const CACHE_NAME = "kopiqo-cache-v6";
const APP_SHELL = [
  "./index.html",
  "./app.compiled.js",
  "./onboarding.compiled.js",
  "./analytics.html",
  "./analytics.compiled.js",
  "./env.js",
  "./supabase-client.js",
  "./auth.js",
  "./storage-sync.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

// Files that change on essentially every deploy — must always try the network
// first, or an update can silently never reach a returning visitor no matter
// how many times the content on the server changes underneath the same URL.
const NETWORK_FIRST = new Set([
  "./index.html", "./app.compiled.js", "./onboarding.compiled.js",
  "./analytics.html", "./analytics.compiled.js",
  "./env.js", "./supabase-client.js", "./auth.js", "./storage-sync.js",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

// Network-first for app code (falls back to cache only when offline) — a
// deploy takes effect on the very next load, not "whenever the cache happens
// to get invalidated". Cache-first only for the two icon files, which never
// change between deploys. Requests to Supabase (auth + data) are NEVER
// cached: user data must always be fresh and must not sit in Cache Storage.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.hostname.endsWith(".supabase.co")) return; // всегда напрямую в сеть

  const isNetworkFirst = [...NETWORK_FIRST].some((f) => url.pathname.endsWith(f.replace("./", "/")));

  if (isNetworkFirst) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
