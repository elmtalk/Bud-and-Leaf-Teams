const CACHE_PREFIX = 'bud-leaf-teams-';
const CACHE_NAME = 'bud-leaf-teams-v6-surveyor-registration';

const CORE_FILES = [
  './index.html',
  './manifest.webmanifest',
  './teams-surveyor.js'
];

function injectTeamsSurveyorScript(html) {
  const marker = '<script src="./teams-surveyor.js"></script>';
  if (html.includes(marker)) return html;
  if (!html.includes('</body>')) return html;
  return html.replace('</body>', marker + '\n</body>');
}

async function htmlResponseWithSurveyorScript(response) {
  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.delete('content-length');

  return new Response(injectTeamsSurveyorScript(html), {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
}

async function fetchCore(url) {
  const response = await fetch(url, { cache: 'reload' });
  if (!response || !response.ok) return response;

  if (url.endsWith('index.html')) {
    return htmlResponseWithSurveyorScript(response);
  }

  return response;
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async function (cache) {
        for (const url of CORE_FILES) {
          try {
            const response = await fetchCore(url);
            if (response && response.ok) {
              await cache.put(url, response.clone());
            }
          } catch (err) {}
        }
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

  const isNavigation =
    request.mode === 'navigate' ||
    url.pathname.endsWith('/Bud-and-Leaf-Teams/') ||
    url.pathname.endsWith('/Bud-and-Leaf-Teams/index.html');

  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then(async function (response) {
          if (!response || !response.ok) return response;

          const transformed = await htmlResponseWithSurveyorScript(response);
          const copy = transformed.clone();

          caches.open(CACHE_NAME)
            .then(function (cache) {
              return cache.put('./index.html', copy);
            })
            .catch(function () {});

          return transformed;
        })
        .catch(function () {
          return caches.match('./index.html')
            .then(function (cached) {
              return cached || Response.error();
            });
        })
    );
    return;
  }

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
            return cached || Response.error();
          });
      })
  );
});
