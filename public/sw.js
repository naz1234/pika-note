const CACHE = "pika-note-shell-v3";
const OFFLINE_ASSETS = ["/offline.html", "/icon-192.png?v=2", "/icon-512.png?v=2"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(OFFLINE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/offline.html")));
  } else if (OFFLINE_ASSETS.includes(`${url.pathname}${url.search}`)) {
    event.respondWith(caches.match(request, { cacheName: CACHE }).then((cached) => cached ?? fetch(request)));
  }
});
