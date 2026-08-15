/* Service worker for Swim. Bump CACHE_VERSION on every deploy. */
const CACHE_VERSION = "swim-v5";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return Promise.all(
        SHELL.map(function (url) {
          return cache.add(url).catch(function () {});
        })
      );
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_VERSION; })
          .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  /* Never intercept Supabase calls, the app handles its own offline queue */
  if (url.hostname.endsWith("supabase.co")) return;

  /* Network first for the shell entry points so updates appear */
  const isNav = req.mode === "navigate";
  const isFresh = url.pathname.endsWith("/index.html") || url.pathname.endsWith("/app.js") ||
    url.pathname.endsWith("/sw.js") || url.pathname.endsWith("/styles.css");
  if (isNav || isFresh) {
    event.respondWith(
      fetch(req).then(function (res) {
        const copy = res.clone();
        caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match("./index.html");
        });
      })
    );
    return;
  }

  /* Cache first for everything else, including fonts and the chart library */
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      });
    })
  );
});
