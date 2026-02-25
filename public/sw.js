const CACHE_NAME = 'antigravity-remote-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/css/app.css',
    '/js/app.js',
    '/manifest.json'
];

// Install — pre-cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        })
    );
    self.clients.claim();
});

// Fetch — network first, fallback to cache
self.addEventListener('fetch', (event) => {
    if (event.request.url.includes('/api/') || event.request.url.includes('/socket.io/')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseClone);
                });
                return response;
            })
            .catch(() => {
                return caches.match(event.request);
            })
    );
});

// Push notifications
self.addEventListener('push', (event) => {
    const data = event.data ? event.data.json() : {};
    const options = {
        body: data.body || 'New notification from Antigravity',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-72.png',
        vibrate: [100, 50, 100],
        data: data,
        actions: data.type === 'approval' ? [
            { action: 'approve', title: '✅ Approve' },
            { action: 'reject', title: '❌ Reject' }
        ] : [
            { action: 'open', title: '📱 Open' }
        ],
        tag: data.tag || 'antigravity-notification',
        renotify: true
    };

    event.waitUntil(
        self.registration.showNotification(data.title || '🚀 Antigravity Remote', options)
    );
});

// Notification click
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            if (clientList.length > 0) {
                clientList[0].focus();
                clientList[0].postMessage({
                    type: 'notification_click',
                    action: event.action,
                    data: event.notification.data
                });
            } else {
                clients.openWindow('/');
            }
        })
    );
});
