// Service Worker désactivé — se désenregistre automatiquement et vide tous les caches
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) { return caches.delete(k); }));
    }).then(function() {
      return self.registration.unregister();
    }).then(function() {
      return self.clients.claim();
    })
  );
});
// Ne jamais intercepter les requêtes — tout passe par le réseau
