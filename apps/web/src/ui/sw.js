// Lightweight network-first service worker so iOS Safari and Android/Chrome
// treat pgroast as an installable standalone app without serving stale API data.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Always let the browser handle requests directly (no stale cache trap)
  if (event.request.method !== "GET") return;
});
