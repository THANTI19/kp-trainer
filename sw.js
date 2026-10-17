// Offline-first: serve the app from cache, refresh the cache in the background.
// Bump VERSION whenever you upload new files so devices pick up the update.
//
// PREFIX must be unique per app: apps on the same GitHub Pages account share one
// origin, and the activate step below deletes old caches that start with PREFIX.
const PREFIX = "kp-";
const VERSION = "v1";
const CACHE = PREFIX + VERSION;
const FILES = [
  "./", "index.html", "style.css", "manifest.webmanifest",
  "js/app.js", "js/store.js", "js/sync.js", "js/srs.js", "js/config.js",
  "data/questions.json", "data/cards.json",
  "icon-180.png", "icon-192.png", "icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) =>
    Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // only handle files of THIS app (its own folder); the other app's worker handles its own
  if (!url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const network = fetch(e.request).then((res) => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
