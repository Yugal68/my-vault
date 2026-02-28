// sw.js — Service worker: caches app shell for offline use
const CACHE = 'mv-v6';
const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './js/crypto.js',
  './js/storage.js',
  './js/github.js',
  './js/app.js',
  './js/ui.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Network first for GitHub API; cache first for app shell
  if (e.request.url.includes('api.github.com')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
