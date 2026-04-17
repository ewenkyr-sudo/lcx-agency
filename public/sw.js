const CACHE_NAME = 'lcx-agency-__BUILD_HASH__';
const ASSETS = [
  '/',
  '/login.html',
  '/dashboard.html',
  '/student.js',
  '/outreach-student.js',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Install: mettre en cache et forcer l'activation immédiate
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// Activate: supprimer tous les anciens caches et prendre le contrôle
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: réseau d'abord, cache uniquement si hors-ligne
self.addEventListener('fetch', (event) => {
  // Ne jamais intercepter les requêtes API ou WebSocket
  if (event.request.url.includes('/api/') || event.request.url.includes('ws')) return;

  // HTML et JS: TOUJOURS le réseau, jamais le cache (sauf hors-ligne)
  const url = event.request.url;
  if (url.endsWith('.html') || url.endsWith('.js') || url.endsWith('/')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Autres assets (images, manifest): réseau puis cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
