/* Cache the shell so the app opens without a connection. */
const CACHE = 'italy-bill-split-__BUILD__';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The page asks for the new version to take over when the person is ready.
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* Network first, so a published update lands the next time the app is
   opened rather than sitting behind a cached copy. The cache is the
   fallback, which keeps the app working with no connection, and the race
   stops a slow connection abroad from hanging the screen. */
const SLOW_MS = 2500;

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);

    // Kept alive past the race: a slow response still refreshes the cache.
    const live = fetch(e.request).then(res => {
      if (res && res.ok) cache.put(e.request, res.clone());
      return res;
    });
    live.catch(() => {});

    const tooSlow = new Promise(resolve => setTimeout(() => resolve('slow'), SLOW_MS));

    try {
      const res = await Promise.race([live, tooSlow]);
      if (res !== 'slow') return res;
    } catch (err) {
      // offline or blocked; fall through to the cache
    }

    const hit = await cache.match(e.request);
    if (hit) return hit;

    if (e.request.mode === 'navigate') {
      const shell = await cache.match('./index.html') || await cache.match('./');
      if (shell) return shell;
    }
    return live;   // nothing cached, so wait it out
  })());
});
