// Service Worker for Samsung TV Remote Control PWA v2.0
const CACHE_NAME = 'tv-remote-v6';
const ASSETS = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/app.js',
    '/manifest.json',
    '/icons/icon-192.svg',
];

// Install event - cache assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            )
        )
    );
    self.clients.claim();
});

// Fetch event - only cache our own static assets, pass through everything else
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Don't intercept WebSocket or cross-origin requests (TV API calls, etc.)
    if (url.origin !== self.location.origin) {
        return;
    }

    // Cache first for our static assets
    event.respondWith(
        caches.match(event.request).then((cached) =>
            cached || fetch(event.request).then((response) => {
                const clone = response.clone();
                caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
                return response;
            })
        ).catch(() => {
            // Offline fallback for main page
            if (event.request.mode === 'navigate') {
                return caches.match('/');
            }
        })
    );
});
