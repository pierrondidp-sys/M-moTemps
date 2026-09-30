(function () {
  "use strict";

  // Public VAPID key for Web Push - not secret, safe to ship in client code.
  // Paired with VAPID_PRIVATE_KEY (a GitHub secret, never committed) that
  // scripts/send-reminders.mjs uses server-side to sign push messages. If
  // this key pair is ever rotated, both sides must be updated together.
  const VAPID_PUBLIC_KEY = "BK63cnyCxEutqS5-kwF9btsKKHK6ZeFu4zll0NOMpAdteOmATvyEgrGRjAQ_A3ADM_9IWxu5ZBMvqoH8v8-Xdsc";

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  // Subscribes this browser/device to push (idempotent - returns the
  // existing subscription if there already is one) so reminders can reach
  // it even when the app is fully closed, not just while it's running (see
  // reminder.js's notifyOS() for that in-app-only case). Only meant to be
  // called once Notification permission is actually granted.
  async function ensureSubscribed() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
    try {
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      if (existing) return existing;
      return await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    } catch (e) {
      return null;
    }
  }

  // Read-only lookup (no subscribe side effect) used by drive.js to include
  // this device's subscription - if any - in the next sync upload.
  async function getSubscription() {
    if (!("serviceWorker" in navigator)) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return null;
    try { return await reg.pushManager.getSubscription(); } catch (e) { return null; }
  }

  window.MemoTempsPush = { ensureSubscribed, getSubscription };
})();
