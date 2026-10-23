const CACHE = 'smm-shell-v6';
const SHELL = [
  './',
  './index.html',
  './login.html',
  './404.html',
  './admin.html',
  './app.js',
  './auth.js',
  './install.js',
  './login.js',
  './login.css',
  './styles.css',
  './admin.js',
  './admin.css',
  './assets/fonts.css',
  './assets/school.webp',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-192.png',
  './assets/icon-maskable-512.png',
  './assets/apple-touch-icon.png',
  './manifest.webmanifest',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

function shellPath(pathname) {
  return pathname.endsWith('/') ? `${pathname}index.html` : pathname;
}

function allowedShell(url) {
  const path = shellPath(url.pathname);
  return SHELL.some(item => {
    const shell = new URL(item, self.registration.scope);
    return shell.pathname === url.pathname || shell.pathname === path;
  });
}

function leaveToNetwork(url) {
  if (url.origin !== self.location.origin) return true;
  if (url.hostname === 'storage.yandexcloud.net' || url.hostname.endsWith('.storage.yandexcloud.net')) return true;
  if (url.pathname.includes('/api/')) return true;
  if (url.search) return true;
  if (/X-Amz-|X-Goog-Signature|Signature=/i.test(url.href)) return true;
  return false;
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (leaveToNetwork(url) || !allowedShell(url)) return;
  event.respondWith(serveShell(event, request));
});

async function serveShell(event, request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request).then(response => {
    if (response && response.ok && response.type === 'basic') return cache.put(request, response.clone()).then(() => response);
    return response;
  }).catch(() => null);
  if (cached) {
    event.waitUntil(refresh);
    return cached;
  }
  const fresh = await refresh;
  if (fresh) return fresh;
  if (request.mode === 'navigate') {
    const fallback = (await cache.match('./index.html')) || (await cache.match('./login.html'));
    if (fallback) return fallback;
  }
  return new Response('Нет сети', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
