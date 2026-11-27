const CACHE_VERSION = 'captnz-board-v1.0.2';
const SHARE_CACHE = 'captnz-share-target-v1';

const APP_SHELL_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.png',
  './icons/icon-128.png',
  './icons/icon-256.png',
  './tesseract/worker.min.js',
  './tesseract/tesseract-core-lstm.wasm.js',
  './tesseract/tesseract-core-simd-lstm.wasm.js',
  './tesseract/eng.traineddata.gz',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      await Promise.allSettled(
        APP_SHELL_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION && key !== SHARE_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Handle Android / Chrome PWA share_target POST
  if (request.method === 'POST' && url.origin === self.location.origin) {
    event.respondWith(
      (async () => {
        try {
          const formData = await request.formData();
          const sharedFile = formData.get('file');
          if (sharedFile && typeof sharedFile.arrayBuffer === 'function') {
            const cache = await caches.open(SHARE_CACHE);
            const headers = new Headers({
              'Content-Type': sharedFile.type || 'application/octet-stream',
              'X-Shared-Filename': encodeURIComponent(sharedFile.name || 'shared-file'),
            });
            await cache.put('/__shared_file__', new Response(sharedFile, { headers }));
            return Response.redirect('./?shared=1', 303);
          }
        } catch {
          // Fall through to app root
        }
        return Response.redirect('./', 303);
      })()
    );
    return;
  }

  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Navigation requests: network-first, fallback to cached index.html offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put('./index.html', clone));
          }
          return response;
        })
        .catch(() => caches.match('./index.html').then((cached) => cached || caches.match('./')))
    );
    return;
  }

  // Static assets, JS chunks, fonts, icons, Tesseract WASM: cache-first with background refresh
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(request).then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, clone));
        }
        return response;
      });
    })
  );
});
