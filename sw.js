// Service worker: rad bez interneta + primanje datoteka podijeljenih u aplikaciju.
const VERSION = 'evidencija-v2';
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/app.js',
  'js/db.js',
  'js/dates.js',
  'js/stamp.js',
  'vendor/pdf-lib.min.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'evidencija-shared').map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function handleShare(request) {
  const form = await request.formData();
  const files = form.getAll('files').filter((f) => f && typeof f !== 'string');
  const cache = await caches.open('evidencija-shared');
  let i = 0;
  for (const f of files) {
    await cache.put(new Request(`shared/${Date.now()}-${i++}`), new Response(f, {
      headers: { 'content-type': f.type || 'application/octet-stream', 'x-name': encodeURIComponent(f.name || 'dijeljeno') },
    }));
  }
  return Response.redirect('./?shared=' + files.length, 303);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(handleShare(request));
    return;
  }
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Mreža prvo (za ažuriranja), predmemorija kao rezerva kad nema veze.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))),
  );
});
