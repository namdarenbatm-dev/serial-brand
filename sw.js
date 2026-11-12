/* Service worker: کش اولیه + اول-کش (cache-first) تا برنامه آفلاین کار کند. */
var CACHE = 'sbd-v4';
var ASSETS = ['./', 'index.html', 'style.css', 'macro-data.js', 'core.js', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
    return hit || fetch(req).then(function (resp) {
      if (resp && resp.ok) { var copy = resp.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return resp;
    }).catch(function () { return caches.match('index.html'); });
  }));
});
