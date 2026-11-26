const cachePrefix = 'rebuild-shell-';
const shellCache = cachePrefix + __SHELL_VERSION__;
const shellFiles = __SHELL_FILES__;
const shellPaths = new Set(shellFiles);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(shellCache);
    await cache.addAll(shellFiles.map((path) => new Request(new URL(path, self.location.origin), {
      cache: 'reload',
      credentials: 'omit',
    })));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(cachePrefix) && key !== shellCache)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin
    || url.search || request.headers.has('Authorization')) return;

  const path = request.mode === 'navigate' && url.pathname === '/' ? '/index.html' : url.pathname;
  if (!shellPaths.has(path)) return;

  event.respondWith((async () => {
    const cache = await caches.open(shellCache);
    return (await cache.match(path)) ?? fetch(request);
  })());
});
