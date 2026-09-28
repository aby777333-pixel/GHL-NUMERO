// NUMERO service worker. Built into dist/sw.js with a version unique to each build (see vite.config.ts).
// What it does, and no more:
//  - pages: always from the network first, so a new release is seen at once; the last page is kept for when there is no connection
//  - /assets/*: files whose names change with their content, so a copy kept is never out of date
//  - anything from another address (the database, the sign-in service, fonts) is never touched: it always goes to the network
const VERSION = '__NUMERO_BUILD__'
const SHELL = 'numero-shell-' + VERSION
const ASSETS = 'numero-assets-' + VERSION

self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png'])).catch(() => undefined))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('numero-') && key !== SHELL && key !== ASSETS) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put('/', copy)) }
      return res
    }).catch(async () => (await caches.match('/')) || Response.error()))
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(ASSETS).then((c) => c.put(req, copy)) }
      return res
    })))
  }
})
