// Uygulama kabuğunu önbelleğe alır; yapay zeka istekleri her zaman ağdan gider.
const ONBELLEK = "tamir-web-4.5";
const DOSYALAR = ["./", "./index.html", "./app.js?v=web-4.5", "./manifest.webmanifest", "./ikon-192.png", "./ikon-512.png"];
self.addEventListener("install", e => {
  // HTTP önbelleğini atla: kurulumda her zaman sunucudaki güncel dosyalar alınsın
  e.waitUntil(caches.open(ONBELLEK).then(c => c.addAll(DOSYALAR.map(u => new Request(u, {cache: "reload"})))));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== ONBELLEK).map(x => caches.delete(x)))));
  self.clients.claim();
});
const bekle = ms => new Promise(ok => setTimeout(() => ok(null), ms));
/**
 * Önce ağ. Ağ 4 sn içinde yanıt vermezse önbellekteki sürüm verilir; önbellekte yoksa ağ isteği BEKLENİR
 * (yavaş ağda yeni sürümün app.js'i yerine index.html verilip uygulamanın açılmaması önlenir).
 * index.html'e geri düşüş yalnızca sayfa gezinmesinde yapılır; betik/simge isteğine asla HTML verilmez.
 */
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;   // API çağrılarına dokunma
  const yedek = () => caches.match(e.request).then(c => c || (e.request.mode === "navigate" ? caches.match("./index.html") : null));
  const ag = fetch(e.request, {cache: "no-cache"}).then(r => {
    // hatalı yanıtı önbelleğe yazma; yazma işi Service Worker kapanmadan tamamlansın
    if (r.ok) { const k = r.clone(); e.waitUntil(caches.open(ONBELLEK).then(c => c.put(e.request, k)).catch(() => {})); }
    // Sunucu geçici hata (5xx) verirse önbellekteki sağlam sürüm kullanılır; 404 aynen geçer
    if (r.status >= 500) return yedek().then(c => c || r);
    return r;
  });
  e.respondWith(Promise.race([ag.catch(() => null), bekle(4000)])
    .then(r => r || yedek().then(c => c || ag))
    .catch(() => yedek().then(c => c || Response.error())));
});
