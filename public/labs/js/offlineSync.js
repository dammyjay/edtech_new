// public/labs/js/offlineSync.js
//
// Shared by both lab editors (public/labs/js/webLab.js and blocklyLab.js)
// — a generic "save this, or queue it if we're offline" helper, so a
// student who loses connectivity mid-lesson doesn't just see silent save
// failures. Deliberately scoped to saving progress only (the one thing
// that's safe/idempotent to replay later) — Submit still requires being
// online, since grading/XP/unlocks are real server-side side effects that
// shouldn't fire from a stale queued request.
//
// Offline detection here doesn't rely on navigator.onLine (unreliable —
// true just means "connected to a network", not "can reach this server")
// — it's purely "did this fetch() reject", which is what actually matters.
//
// Exposes window.OfflineSync = { saveOrQueue, flushQueue, onStatusChange }.

(function () {
  const QUEUE_KEY = "labOfflineSyncQueue";
  const statusListeners = [];

  function readQueue() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) || "{}");
    } catch (e) {
      return {};
    }
  }

  function writeQueue(queue) {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
      // localStorage can throw (private mode, quota) — the save itself
      // already went through or failed above; losing the offline queue
      // just means this one save won't auto-retry, not a hard error.
      console.error("OfflineSync: failed to persist queue:", e);
    }
  }

  function emitStatus() {
    const queue = readQueue();
    const pendingCount = Object.keys(queue).length;
    statusListeners.forEach((cb) => {
      try {
        cb({ pendingCount });
      } catch (e) {
        console.error("OfflineSync status listener error:", e);
      }
    });
  }

  function onStatusChange(cb) {
    statusListeners.push(cb);
  }

  // Attempts the real POST; on a genuine network failure (fetch rejects —
  // essentially only happens offline/DNS-down, not on HTTP error statuses,
  // which still resolve normally), queues it instead and returns a
  // synthetic success so the caller can treat it as "saved locally".
  async function saveOrQueue(url, payload, dedupeKey) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      // This save reached the server — any earlier queued (now stale)
      // save for the same slot is superseded by it.
      const queue = readQueue();
      if (queue[dedupeKey]) {
        delete queue[dedupeKey];
        writeQueue(queue);
        emitStatus();
      }

      return { ...data, queued: false };
    } catch (err) {
      const queue = readQueue();
      queue[dedupeKey] = { url, payload, queuedAt: Date.now() };
      writeQueue(queue);
      emitStatus();
      return { success: true, queued: true };
    }
  }

  // Replays every queued save, in no particular order — each is keyed by
  // dedupeKey (one per project slot), so this is at most a handful of
  // requests, not one per offline edit.
  async function flushQueue() {
    const queue = readQueue();
    const keys = Object.keys(queue);
    if (!keys.length) return;

    for (const key of keys) {
      const entry = queue[key];
      try {
        const res = await fetch(entry.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(entry.payload),
        });
        if (res.ok) {
          delete queue[key];
        }
      } catch (err) {
        // Still offline (or the request genuinely failed again) — leave
        // it queued, try again next time flushQueue runs.
      }
    }
    writeQueue(queue);
    emitStatus();
  }

  window.addEventListener("online", flushQueue);
  // Also try once on load — covers the case where the student closed the
  // tab while offline and reopened it after connectivity was back, so
  // the 'online' event (which only fires on a state *transition*) never
  // had a chance to.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", flushQueue);
  } else {
    flushQueue();
  }

  window.OfflineSync = { saveOrQueue, flushQueue, onStatusChange };
})();
