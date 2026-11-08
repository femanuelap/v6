/* ============================================================
   FANFIC PLAYER — sw.js (Service Worker)
   Cacheia o shell do app (HTML/CSS/JS) e os CDNs estáticos
   para permitir uso 100% offline após a primeira visita.
   ============================================================ */

const CACHE_NAME = "fp-cache-v1";

const CORE_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icon-192.svg",
  "./icon-512.svg"
];

const CDN_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/epub.js/0.3.93/epub.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
  "https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&family=Inter:wght@400;500;600;700&display=swap"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(CORE_ASSETS).catch((err) => console.warn("[SW] Falha ao cachear core assets:", err))
    ).then(() =>
      caches.open(CACHE_NAME).then((cache) =>
        Promise.allSettled(CDN_ASSETS.map((url) =>
          fetch(url, { mode: "cors" }).then((resp) => resp.ok && cache.put(url, resp)).catch(() => {})
        ))
      )
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Estratégia: Cache First com atualização em segundo plano (stale-while-revalidate)
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkFetch = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || networkFetch;
    })
  );
});

// Permite que o app force a atualização do Service Worker via postMessage
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
