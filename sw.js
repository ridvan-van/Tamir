// Uygulama kabuğunu önbelleğe alır; yapay zeka istekleri her zaman ağdan gider.
const ONBELLEK = "tamir-tel-1.2";
const DOSYALAR = ["./", "./index.html", "./app.js", "./manifest.webmanifest", "./ikon-192.png", "./ikon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(ONBELLEK).then(c => c.addAll(DOSYALAR))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== ONBELLEK).map(x => caches.delete(x)))));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;   // API çağrılarına dokunma
  // Önce ağ (güncel sürüm), ağ yoksa önbellek
  e.respondWith(fetch(e.request).then(r => { const k = r.clone(); caches.open(ONBELLEK).then(c => c.put(e.request, k)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match("./index.html"))));
});
