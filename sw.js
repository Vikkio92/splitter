// Offline support: network first (so updates show up straight away), cache as fallback.
// Only the app's own files, the Firebase SDK and the fonts are cached; live database traffic is left alone.
const CACHE = "splitter-v34";
const ASSETS = ["./", "./index.html", "./firebase-config.js", "./manifest.json", "./icon-180.png", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const cacheable = ["www.gstatic.com", "fonts.googleapis.com", "fonts.gstatic.com"];
  if (url.origin !== location.origin && !cacheable.includes(url.hostname)) return;
  if (url.pathname.includes("/recaptcha/")) return;   // let reCAPTCHA talk to Google directly

  e.respondWith(
    caches.open(CACHE).then((cache) => {
      const cached = () => cache.match(e.request, { ignoreSearch: true });
      // The app's own files always ask the website whether there's a newer version (GitHub Pages
      // otherwise lets phones reuse a copy for 10 minutes); other files come from the browser's cache.
      const ownFile = url.origin === location.origin;
      const net = (ownFile ? fetch(e.request.url, { cache: "no-cache", credentials: "same-origin" }) : fetch(e.request)).then((res) => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      });
      net.catch(() => {});
      // Slow restaurant wifi: fall back to the cached copy after 3 seconds.
      const slow = new Promise((r) => setTimeout(r, 3000)).then(cached);
      return Promise.race([net, slow]).then((res) => res || net).catch(cached);
    })
  );
});
