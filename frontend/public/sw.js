const CACHE_NAME = 'mesh-shell-v1';
const APP_SHELL = ['/', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/oauth2/')
  ) {
    return;
  }

  event.respondWith(
    fetch(request)
      .then(async (response) => {
        if (
          response.ok &&
          (request.mode === 'navigate' ||
            ['script', 'style', 'image', 'font'].includes(request.destination))
        ) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') return caches.match('/');
        throw new Error('The requested resource is not available offline.');
      }),
  );
});

self.addEventListener('push', (event) => {
  let notice;
  try {
    notice = event.data?.json() ?? {};
  } catch {
    notice = { title: '図書館ノート', message: event.data?.text() ?? '' };
  }

  event.waitUntil(
    self.registration.showNotification(notice.title ?? '図書館ノート', {
      body: notice.message ?? '図書館の状況が更新されました。',
      icon: '/icon.svg',
      badge: '/icon.svg',
      data: { url: notice.url ?? '/' },
      tag: notice.type ?? 'library-update',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(
    event.notification.data?.url ?? '/',
    self.location.origin,
  );
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        const client = clients.find((item) =>
          item.url.startsWith(target.origin),
        );
        if (client) {
          client.navigate(target.href);
          return client.focus();
        }
        return self.clients.openWindow(target.href);
      }),
  );
});
