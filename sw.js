self.addEventListener('install', function(event) {
  // Service worker is installed
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  // Service worker is activated
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function(event) {
  // Basic pass-through fetch handler
  // This satisfies the PWA install criteria
  event.respondWith(fetch(event.request));
});
