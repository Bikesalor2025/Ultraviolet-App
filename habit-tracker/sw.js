// Offline support. Network first, so an online visit always gets the latest
// files; the cache only answers when the network is down or slow.

const CACHE = 'streakfire-shell';
const SHELL = [
  './',
  'styles.css',
  'app.js',
  'logic.js',
  'fire.js',
  'vault.js',
  'share.js',
  'favicon.svg',
  'manifest.webmanifest',
  'icon-180.png',
  'icon-192.png',
  'icon-512.png',
];
const SLOW_MS = 4000;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const network = fetch(request).then((response) => {
    // Only same-origin successes are worth keeping (not login redirects).
    if (response.ok && response.type === 'basic') cache.put(request, response.clone());
    return response;
  });
  const quick = await Promise.race([
    network.catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), SLOW_MS)),
  ]);
  if (quick) return quick;
  const cached = await cache.match(request, { ignoreSearch: true });
  return cached ?? network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});
