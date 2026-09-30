const CACHE_NAME = "mt-cache-v30";
const APP_SHELL = [
  "./",
  "./index.html",
  "./css/widget.css",
  "./js/widget.js",
  "./js/outlook.js",
  "./js/drive.js",
  "./js/flipclock.js",
  "./js/backup.js",
  "./js/reminder.js",
  "./js/push.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// Tapping a reminder notification should focus the app if it's already
// open somewhere, or open a new tab/window if it isn't - not just dismiss
// the notification and leave the user having to go find it themselves.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("./");
    })
  );
});

// Real background push: fired by scripts/send-reminders.mjs (GitHub Actions
// cron) via web-push, so this runs even if the app/tab is fully closed -
// unlike reminder.js's notifyOS(), which only fires while the page is alive.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* non-JSON payload: use defaults below */ }

  const title = data.title || "Mémo Temps";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      tag: data.tag || "mt-push",
      renotify: true
    })
  );
});
