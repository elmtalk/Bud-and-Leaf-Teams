const CACHE_PREFIX = 'bud-leaf-teams-';
const CACHE_NAME = 'bud-leaf-teams-v6a-surveyor-safe';

const CORE_FILES = [
  './index.html',
  './manifest.webmanifest',
  './teams-surveyor.js'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) {
        return Promise.all(
          CORE_FILES.map(function (url) {
            return fetch(url, { cache: 'reload' })
              .then(function (response) {
                if (response && response.ok) {
                  return cache.put(url, response.clone());
                }
              })
              .catch(function () {
                return null;
              });
          })
        );
      })
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) {
              return key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME;
            })
            .map(function (key) {
              return caches.delete(key);
            })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

self.addEventListener('fetch', function (event) {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then(function (response) {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME)
            .then(function (cache) {
              return cache.put(request, copy);
            })
            .catch(function () {});
        }
        return response;
      })
      .catch(function () {
        return caches.match(request)
          .then(function (cached) {
            if (cached) return cached;

            if (request.mode === 'navigate') {
              return caches.match('./index.html')
                .then(function (fallback) {
                  return fallback || Response.error();
                });
            }

            return Response.error();
          });
      })
  );
});
