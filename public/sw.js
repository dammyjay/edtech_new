// public/sw.js
//
// Two unrelated jobs live in this one file, since a page can only ever
// register one service worker: web push (the original, still untouched
// below) and offline-first caching for the coding labs (Web Lab / Blockly
// Lab), added here.
//
// Offline strategy — three tiers, chosen by what's actually safe to serve
// stale/from-cache for each kind of request:
//   1. Lab page navigations (/labs, /labs/web, /labs/blockly): network
//      first, falling back to the last-cached version only when the
//      network genuinely fails. An online student always sees fresh
//      data (their real XP/coins/streak, lesson banner, etc.) — the
//      cache is purely a "something to show" fallback for offline.
//   2. Same-origin static lab assets (JS/CSS under /labs, /js, /css,
//      /images): network first, falling back to cache only when the
//      network fails — same reasoning as tier 1. These are OUR OWN code,
//      actively changing; cache-first here meant a browser that had ever
//      cached, say, arduinoLab.js would keep serving that exact stale
//      copy forever afterward (every deploy included), no matter how
//      many times the file changed on the server, until something forced
//      a hard refresh. Was cache-first originally; switched after that
//      bit the Arduino Lab specifically (in active development, so its
//      JS/CSS were changing across near-daily deploys).
//   2b. The CDN hosts the lab editors load Monaco/Blockly/Font Awesome/
//      wokwi-elements/avr8js from: still cache first, filling the cache
//      from the network the first time each one is actually requested.
//      Those really are static by nature (pinned, versioned CDN URLs —
//      a new version means a new URL, never the same URL changing
//      underneath us) — that's what makes the CDN-hosted editor engines
//      work offline, without needing a hand-maintained list of every
//      file Monaco's own loader pulls in at runtime.
//   3. Everything else (every API call — /labs/project/save,
//      /labs/gallery/*, auth, etc.) is deliberately NOT intercepted at
//      all. A service worker pretending an API POST "succeeded" from
//      cache would be actively wrong; public/labs/js/offlineSync.js
//      handles the one case worth queuing (saving lab progress) at the
//      application level instead, where it can be honest about what
//      happened.

const CACHE_NAME = "jkt-labs-v2"; // v1 -> v2: same-origin static assets moved off cache-first (see tier 2 above)

// Deliberately does NOT include /labs, /labs/web, /labs/blockly — those
// are gated by ensureAuthenticated (routes/labRoutes.js), and the service
// worker's own install can fire on a page visited before the student is
// logged in (registration happens from views/partials/notificationBell.ejs,
// included site-wide, not just on the lab pages). Precaching them here
// could silently cache the login redirect's HTML under the lab page's
// URL instead of the real content. They get cached correctly and safely
// instead the normal way: networkFirst() below caches on any successful
// (200, meaning actually authenticated) visit.
const PRECACHE_URLS = [
  "/css/style.css",
  "/css/styles2.css",
  "/css/styles3.css",
  "/js/uiAlerts.js",
  "/js/markdownLite.js",
  "/labs/css/web.css",
  "/labs/css/blockly.css",
  "/labs/js/webLab.js",
  "/labs/js/blocklyLab.js",
  "/labs/js/labAiTutor.js",
  "/labs/js/offlineSync.js",
  "/labs/js/blockly/engine.js",
  "/labs/js/blockly/blocks/motion.js",
  "/labs/js/blockly/blocks/looks.js",
  "/labs/js/blockly/blocks/events.js",
  "/labs/js/blockly/blocks/console.js",
  "/labs/js/blockly/blocks/sensors.js",
  "/labs/js/blockly/blocks/control.js",
  "/labs/js/blockly/blocks/pen.js",
  "/labs/js/blockly/generators/motion.js",
  "/labs/js/blockly/generators/looks.js",
  "/labs/js/blockly/generators/events.js",
  "/labs/js/blockly/generators/console.js",
  "/labs/js/blockly/generators/sensors.js",
  "/labs/js/blockly/generators/control.js",
];

// Requests to these hosts (Monaco/Blockly/Font Awesome CDNs — see
// views/labs/web/editor.ejs and views/labs/blockly/editor.ejs) are cached
// opportunistically as they're actually requested, rather than
// precached — Monaco's own AMD loader pulls in dozens of files at
// runtime depending on what's used, with no fixed list to hardcode.
const RUNTIME_CACHE_HOSTS = ["cdnjs.cloudflare.com", "unpkg.com"];

const LAB_NAVIGATION_PATHS = ["/labs", "/labs/web", "/labs/blockly"];
const STATIC_ASSET_PREFIXES = ["/labs/", "/js/", "/css/", "/images/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch((err) => console.error("sw precache failed:", err))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never intercept saves/API writes

  const url = new URL(request.url);

  if (RUNTIME_CACHE_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate" && LAB_NAVIGATION_PATHS.includes(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (STATIC_ASSET_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(networkFirst(request));
    return;
  }
});

self.addEventListener("push", (event) => {
  const data = event.data.json();
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.message,
      icon: "/logo.png",
      data: { url: data.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.notification.data?.url) {
    event.waitUntil(clients.openWindow(event.notification.data.url));
  }
});
