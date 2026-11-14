// Offline support. Each VERSION is one complete, matching set of files, downloaded fresh in one
// go and never changed afterwards, so the app can never run a mix of old and new files. A new
// version is picked up when this file changes: bump VERSION on every release.

const VERSION = 'shiftlist-11';
const SHELL = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'src/app.js',
  'src/store.js',
  'src/seed.js',
  'src/vault.js',
  'src/photos.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' goes past the browser's own cache, so every file is the published one.
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.open(VERSION)
      .then((cache) => cache.match(e.request, { ignoreSearch: true }))
      .then((cached) => cached || fetch(e.request)),
  );
});
