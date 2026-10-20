const CACHE_PREFIX = 'bud-leaf-teams-';
const CACHE_NAME = 'bud-leaf-teams-v4-mobile-layout-fix';
const CORE_FILES = [
  './index.html',
  './manifest.webmanifest',
  './teams-v11.js'
];

function replaceAllText(text, find, replacement) {
  return String(text).split(find).join(replacement);
}

function teamsHtml(text) {
  let html = String(text);

  html = replaceAllText(html, "const DB_NAME='bud-field-app-v1';", "const DB_NAME='bud-field-app-teams-v1';");
  html = replaceAllText(html, "const BUD_FALLBACK_PROJECTS_KEY='bud_projects_fallback_v01012';", "const BUD_FALLBACK_PROJECTS_KEY='bud_teams_projects_fallback_v1';");
  html = replaceAllText(html, 'budleaf_settings_rc2e', 'budleaf_teams_settings_v1');
  html = replaceAllText(html, '<title>Bud&Leaf Beta</title>', '<title>Bud&Leaf Teams</title>');

  if (!html.includes('teams-v11.js')) {
    html = html.replace('</body>', '<script src="./teams-v11.js"></script>\n</body>');
  }
  return html;
}

async function transformHtmlResponse(response) {
  if (!response) return response;
  const text = await response.text();
  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.delete('content-length');
  return new Response(teamsHtml(text), {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
}

async function fetchCore(url) {
  const response = await fetch(url, { cache: 'reload' });
  if (!response || !response.ok) return response;
  if (url.endsWith('index.html')) return transformHtmlResponse(response);
  return response;
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async function (cache) {
        for (const url of CORE_FILES) {
          try {
            const response = await fetchCore(url);
            if (response && response.ok) await cache.put(url, response.clone());
          } catch (err) {}
        }
      })
      .then(function () { return self.skipWaiting(); })
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
            .map(function (key) { return caches.delete(key); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isTeamsNavigation =
    request.mode === 'navigate' ||
    url.pathname.endsWith('/Bud-and-Leaf-Teams/') ||
    url.pathname.endsWith('/Bud-and-Leaf-Teams/index.html');

  if (isTeamsNavigation) {
    event.respondWith(
      fetch(request)
        .then(async function (response) {
          if (!response || !response.ok) return response;
          const transformed = await transformHtmlResponse(response);
          const copy = transformed.clone();
          caches.open(CACHE_NAME)
            .then(function (cache) { return cache.put('./index.html', copy); })
            .catch(function () {});
          return transformed;
        })
        .catch(function () {
          return caches.match('./index.html').then(function (cached) {
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
            .then(function (cache) { return cache.put(request, copy); })
            .catch(function () {});
        }
        return response;
      })
      .catch(function () {
        return caches.match(request).then(function (cached) {
          return cached || Response.error();
        });
      })
  );
});
