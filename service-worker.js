self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open('mono-v1').then(c => c.addAll([
    './','index.html','app.js','manifest.json','icons/icon-192.png','icons/icon-512.png'
  ])));
});
self.addEventListener('activate', e => { self.clients.claim(); });
self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});