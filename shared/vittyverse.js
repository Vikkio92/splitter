// Shared VittyVerse behaviour, loaded by every page (home, Splitter.ino, Gymmer.ino, Shior.ino) before the app's own code.
// - No zooming anywhere: no spreading two fingers, no double-tap. iPhone Safari ignores the viewport's
//   user-scalable=no, so spreading fingers is stopped here; double-tap zoom is off through touch-action in the
//   stylesheet. Pinching in is left alone: the page is already at its smallest, and in Safari it shows your tabs.
// - Motion: the floating tab bar's pill slides to the tab you pick, views cross-fade when you change section,
//   and sheets slide away instead of vanishing. All of it stays still with "Reduce motion" on.
// - The tab bar can be dragged: slide a finger along it and the lens follows, and the section under the finger opens
//   as you go, like the tab bars in Apple's own apps.
// - Every bottom sheet (.sheet) swipes down to close, in every app.
// - Opening an app shows its splash (.vv-splash: the icon's mark on the icon's colour, the name and its line) for
//   about a second, once per launch; a reload in the same session goes straight in.
// Exposed as window.VV for the apps: VV.swap(update), VV.dismiss(el, done), VV.keep(el), VV.noZoom(doc).
(function () {
  "use strict";
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- no zoom ----------
  // Only zooming in is stopped: two fingers moving apart. Fingers moving together are left alone, because the page
  // can't get any smaller than it is (initial-scale=1), and at that size Safari turns a pinch in into its own
  // gesture: showing all your tabs. Stopping every two-finger move (as this once did) took that away too.
  function noZoom(doc) {
    const apart = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    let last = 0;
    doc.addEventListener("touchstart", (e) => { if (e.touches.length === 2) last = apart(e.touches); }, { passive: true });
    doc.addEventListener("touchmove", (e) => {
      if (e.touches.length !== 2) return;
      const d = apart(e.touches);
      if (d > last + 1) e.preventDefault();   // spreading: that's a zoom in
      last = d;
    }, { passive: false });
    // Safari's own pinch events: scale above 1 is zooming in (gesturestart is left alone, or the whole pinch, tabs
    // gesture included, would be cancelled)
    doc.addEventListener("gesturechange", (e) => { if (e.scale > 1) e.preventDefault(); }, { passive: false });
  }
  noZoom(document);

  // ---------- the opening splash ----------
  // The page's .vv-splash covers everything from the first paint; it lifts away once the app has had a moment to
  // draw underneath. Once per launch: sessionStorage starts empty each time a home-screen app is opened.
  // The status bar: while html has .vv-splashing, the theme-color tags carry the splash colour (applyTheme below
  // keeps it so), and lifting the splash hands them back in the same moment. The splash itself isn't position: fixed,
  // because iPhone Safari colours its status bar from a fixed element at the top and is slow to let go of that colour.
  (function splash() {
    let seen = false;
    try { const k = "vv-splash:" + location.pathname; seen = !!sessionStorage.getItem(k); sessionStorage.setItem(k, "1"); } catch (e) {}
    const root = document.documentElement;
    if (seen) { root.classList.add("vv-no-splash"); return; }
    root.classList.add("vv-splashing");
    const colour = getComputedStyle(root).getPropertyValue("--splash").trim();
    if (colour) document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", colour));
    // on its own clock, not the page's load events: an app's start-up code can hold those back
    const lift = () => {
      const el = document.querySelector(".vv-splash");
      if (!el && document.readyState === "loading") return setTimeout(lift, 50);
      root.classList.remove("vv-splashing");
      applyTheme();   // the status bar goes back to the page's colour as the splash fades
      if (!el) return;
      el.classList.add("out");
      setTimeout(() => el.remove(), reduced() ? 0 : 520);
    };
    setTimeout(lift, Math.max(0, 1600 - performance.now()));
  })();

  // ---------- view changes: a short cross-fade with a small rise, tab bar and header held still ----------
  // `update` changes the page (it may return a promise); without View Transitions it simply runs.
  let dragging = false;   // a finger dragging along a tab bar: sections switch instantly, without fading
  function swap(update) {
    if (!document.startViewTransition || reduced() || document.hidden || dragging) return Promise.resolve(update());
    let result;
    // don't hold the old picture for long if the new view is slow to draw
    const t = document.startViewTransition(() => Promise.race([result = Promise.resolve(update()), new Promise((r) => setTimeout(r, 350))]));
    t.ready.catch(() => {});
    return t.updateCallbackDone.then(() => result);
  }

  // ---------- sheets and dialogs leave the way they came ----------
  // Adds .leaving (the stylesheet slides the sheet down and fades the scrim), then calls done.
  function dismiss(el, done) {
    if (!el || reduced()) return done && done();
    clearTimeout(el._vvLeave);
    el.classList.add("leaving");
    el._vvLeave = setTimeout(() => { el.classList.remove("leaving"); done && done(); }, 190);
  }
  // Cancels a dismiss in progress (a dialog that is reopened straight away).
  function keep(el) {
    if (!el) return;
    clearTimeout(el._vvLeave);
    el.classList.remove("leaving");
  }

  // ---------- floating tab bar: one pill that glides between tabs ----------
  // The apps keep marking the current tab with .on; the pill follows it with a gentle spring.
  function pill(bar) {
    if (bar._vvPill) return;
    const thumb = document.createElement("span");
    thumb.className = "tab-thumb";
    thumb.setAttribute("aria-hidden", "true");
    bar.prepend(thumb);
    bar._vvPill = true;
    bar.classList.add("has-thumb");
    let x = null, w = null, raf = 0, from = null, to = null, t0 = 0;
    // where the current tab is (every tab is the same width and never changes size, so its box is the target)
    const target = () => {
      const on = [...bar.children].find((el) => el !== thumb && el.classList.contains("on"));
      return on ? { x: on.offsetLeft, w: on.offsetWidth } : null;
    };
    const paint = () => { thumb.style.transform = `translateX(${x}px)`; thumb.style.width = `${w}px`; };
    // a glide timed by the clock, not by frames, so a busy frame (a new view drawing) can't throw it off;
    // it eases out with the slightest overshoot, then settles
    const GLIDE = 420;
    const ease = (p) => { const q = p - 1, s = 0.9; return 1 + (s + 1) * q * q * q + s * q * q; };
    let held = false;   // while a finger drags along the bar, the lens follows the finger instead of gliding
    const step = (now) => {
      raf = 0;
      if (held) return;
      const t = target();
      if (!t) { thumb.style.opacity = "0"; return; }
      thumb.style.opacity = "";
      if (x === null || reduced()) { x = t.x; w = t.w; paint(); return; }
      if (!to || Math.abs(to.x - t.x) > 0.5 || Math.abs(to.w - t.w) > 0.5) { from = { x, w }; to = t; t0 = now; }
      const p = Math.min(1, (now - t0) / GLIDE), e = ease(p);
      x = from.x + (to.x - from.x) * e; w = from.w + (to.w - from.w) * e;
      paint();
      if (p < 1) raf = requestAnimationFrame(step);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(step); };
    new MutationObserver(kick).observe(bar, { subtree: true, attributes: true, attributeFilter: ["class"] });
    if (window.ResizeObserver) new ResizeObserver(kick).observe(bar);
    // put the pill in place before the first paint, without gliding in
    const t = target(); if (t) { x = t.x; w = t.w; paint(); } else thumb.style.opacity = "0";
    kick();

    // ---------- dragging along the bar ----------
    // A press that moves more than a few pixels becomes a drag: the lens rides under the finger, and whichever tab the
    // finger is over opens straight away (the app's own tap does it, so every app works unchanged). On release the
    // lens settles on that tab. A press that doesn't move is an ordinary tap.
    const tabs = () => [...bar.children].filter((el) => el !== thumb);
    const tabAt = (clientX) => {
      const all = tabs();
      let best = null, dist = Infinity;
      for (const el of all) {
        const r = el.getBoundingClientRect();
        const d = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
        if (d < dist) { dist = d; best = el; }
      }
      return best;
    };
    let press = null;   // { id, x0, dragging, over }
    // the tap a release would otherwise make right after a drag: the section is already open, so it's ignored
    let draggedAt = 0;
    bar.addEventListener("click", (ev) => { if (ev.isTrusted && Date.now() - draggedAt < 400) { ev.preventDefault(); ev.stopPropagation(); } }, { capture: true });
    bar.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || press) return;
      press = { id: e.pointerId, x0: e.clientX, dragging: false, over: null };
    });
    bar.addEventListener("pointermove", (e) => {
      if (!press || e.pointerId !== press.id) return;
      if (!press.dragging) {
        if (Math.abs(e.clientX - press.x0) < 8) return;
        press.dragging = true;
        held = true;
        dragging = true;
        bar.classList.add("dragging");
        try { bar.setPointerCapture(e.pointerId); } catch (err) {}
      }
      const tab = tabAt(e.clientX);
      if (!tab) return;
      const bar0 = bar.getBoundingClientRect(), r = tab.getBoundingClientRect(), pad = parseFloat(getComputedStyle(bar).paddingLeft) || 0;
      w = r.width;
      x = Math.max(pad, Math.min(bar0.width - pad - w, e.clientX - bar0.left - w / 2));
      paint();
      if (tab !== press.over) {
        press.over = tab;
        if (!tab.classList.contains("on")) tab.click();   // open that section now
      }
    });
    const release = (e) => {
      if (!press || (e && e.pointerId !== press.id)) return;
      const dragged = press.dragging;
      press = null;
      if (!dragged) return;
      held = false;
      dragging = false;
      to = null;
      bar.classList.remove("dragging");
      draggedAt = Date.now();
      kick();
    };
    bar.addEventListener("pointerup", release);
    bar.addEventListener("pointercancel", () => { if (press) { press.dragging = true; release(); } });
  }
  const pills = () => document.querySelectorAll(".tabbar").forEach(pill);

  // ---------- sheets swipe down to close ----------
  // Any bottom sheet (.sheet) closes with a swipe down from the top of its content, as on any phone: a flick or a long
  // drag closes it, a short drag springs back. It closes the way a tap outside does (a click on its backdrop, the .scrim
  // around it or beside it), so each app's own closing runs. A long sheet still scrolls: the swipe only starts when it's
  // scrolled to the top, and never from a field being typed in.
  (function swipeSheets() {
    const backdrop = (sheet) => {
      const host = sheet.parentElement;
      if (!host) return null;
      return host.classList.contains("scrim") ? host : host.querySelector(":scope > .scrim");
    };
    let el = null, y0 = 0, dy = 0, t0 = 0;
    document.addEventListener("touchstart", (e) => {
      el = null;
      const sheet = e.target.closest && e.target.closest(".sheet");
      if (!sheet || e.touches.length > 1 || sheet.scrollTop > 0 || e.target.closest("input, select, textarea") || !backdrop(sheet)) return;
      el = sheet; y0 = e.touches[0].clientY; dy = 0; t0 = e.timeStamp;
    }, { passive: true });
    document.addEventListener("touchmove", (e) => {
      if (!el) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      if (!dy) { el.style.removeProperty("--swipe"); el.style.transform = ""; return; }   // upwards: the sheet scrolls as usual
      e.preventDefault();
      el.style.setProperty("--swipe", dy + "px");
      el.style.transform = "translateY(var(--swipe))";
    }, { passive: false });
    const end = (e) => {
      if (!el) return;
      const sheet = el;
      el = null;
      if (!dy) return;
      const flick = dy > 40 && e.timeStamp - t0 < 250;
      const b = backdrop(sheet);
      if ((dy > 110 || flick) && b) { b.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); return; }
      if (!reduced()) sheet.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }], { duration: 200, easing: "cubic-bezier(.2, .8, .2, 1)" });
      sheet.style.removeProperty("--swipe");
      sheet.style.transform = "";
    };
    document.addEventListener("touchend", end);
    document.addEventListener("touchcancel", end);
  })();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", pills); else pills();

  // ---------- light or dark ----------
  // One setting for the whole suite ("vittyverse-theme": "light" or "dark", or absent to follow the device). Each page's
  // <head> applies it before the first paint; VV.themeControl() is the switch for an app's Settings. A change (here,
  // in another tab, or the device switching) fires "vv-theme" on window, for anything that has to redraw.
  const THEME = "vittyverse-theme";
  const themeNow = () => { try { return localStorage.getItem(THEME) || "auto"; } catch (e) { return "auto"; } };
  const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
  function applyTheme() {
    const v = themeNow();
    if (v === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v;
    const splash = document.documentElement.classList.contains("vv-splashing") && getComputedStyle(document.documentElement).getPropertyValue("--splash").trim();
    const bg = splash || (isDark() ? "#000000" : "#f2f2f7");   // the status bar matches the page (or the splash, while it's up)
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", bg));
    document.querySelectorAll("[data-vv-theme] button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
    dispatchEvent(new Event("vv-theme"));
  }
  function setTheme(v) {
    try { v === "auto" ? localStorage.removeItem(THEME) : localStorage.setItem(THEME, v); } catch (e) {}
    applyTheme();
  }
  const themeControl = () => `<div class="seg" data-vv-theme role="radiogroup" aria-label="Appearance">${
    [["auto", "System"], ["light", "Light"], ["dark", "Dark"]].map(([v, l]) => `<button type="button" data-v="${v}" class="${themeNow() === v ? "on" : ""}">${l}</button>`).join("")}</div>`;
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("[data-vv-theme] button"); if (b) setTheme(b.dataset.v); });
  addEventListener("storage", (e) => { if (e.key === THEME) applyTheme(); });
  addEventListener("pageshow", applyTheme);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

  // ---------- glass ----------
  // How the suite's glass looks: the three kinds on liquid-glass.ybouane.com, "regular" (clear, barely blurred),
  // "frosted" (the default) or "dark" (smoked, with light text on it). One setting for the whole suite, kept as
  // "vittyverse-glass" like the theme and set on <html> as data-glass before the first paint (this script runs in
  // <head>); the shared stylesheet does the rest, and Watcher's liquid glass reads it too. VV.appearanceControl() is an
  // app's Settings > Appearance (theme and glass), and a change fires "vv-glass" on window.
  const GLASS = "vittyverse-glass";
  const glassNow = () => { try { const v = localStorage.getItem(GLASS); return v === "regular" || v === "dark" ? v : "frosted"; } catch (e) { return "frosted"; } };
  function applyGlass() {
    const v = glassNow();
    if (v === "frosted") delete document.documentElement.dataset.glass; else document.documentElement.dataset.glass = v;
    document.querySelectorAll("[data-vv-glass] button").forEach((b) => b.classList.toggle("on", b.dataset.v === v));
    dispatchEvent(new Event("vv-glass"));
  }
  function setGlass(v) {
    try { v === "frosted" ? localStorage.removeItem(GLASS) : localStorage.setItem(GLASS, v); } catch (e) {}
    applyGlass();
  }
  const glassControl = () => `<div class="seg" data-vv-glass role="radiogroup" aria-label="Glass">${
    [["regular", "Regular"], ["frosted", "Frosted"], ["dark", "Dark"]].map(([v, l]) => `<button type="button" data-v="${v}" class="${glassNow() === v ? "on" : ""}">${l}</button>`).join("")}</div>`;
  const appearanceControl = () => `<div class="vv-appearance"><div class="field"><span>Theme</span>${themeControl()}</div><div class="field"><span>Glass</span>${glassControl()}</div></div>`;
  document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("[data-vv-glass] button"); if (b) setGlass(b.dataset.v); });
  addEventListener("storage", (e) => { if (e.key === GLASS) applyGlass(); });
  addEventListener("pageshow", applyGlass);
  applyGlass();

  // ---------- the VittyVerse logo and signature ----------
  // The logo is built from its letters by tools/make_logo.py (between the markers): VV.logo() is the wordmark,
  // VV.mark() the square "vv" mark, both inline SVG in the text colour.
  // logo:begin
  const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0.0 8.3 452.7 113.5" fill="currentColor" role="img" aria-label="VittyVerse"><path d="M28.125 98.72500000000001Q25.700000000000003 98.72500000000001 23.975 97.82500000000002Q22.25 96.92500000000001 21.3 95.025L3.325 59.12500000000001Q1.5 55.475 2.2375 53.125Q2.975 50.775000000000006 6.75 48.95Q10.575000000000001 47.075 12.837500000000002 47.6625Q15.100000000000001 48.25 16.900000000000002 52.35L28.125 78.42500000000001L39.275000000000006 52.675000000000004Q41.150000000000006 48.425000000000004 43.3875 47.7Q45.625 46.975 49.625 48.975Q53.675000000000004 50.95 54.1375 53.462500000000006Q54.6 55.975 52.900000000000006 59.325L34.975 95.0Q34.050000000000004 96.875 32.35 97.80000000000001Q30.650000000000002 98.72500000000001 28.125 98.72500000000001Z"/><path d="M66.575 98.35000000000001Q62.95 98.35000000000001 61.362500000000004 97.26250000000002Q59.775000000000006 96.17500000000001 59.45 94.4375Q59.12500000000001 92.7 59.12500000000001 90.775V55.875Q59.12500000000001 53.95 59.48750000000001 52.25Q59.85000000000001 50.550000000000004 61.43750000000001 49.47500000000001Q63.025000000000006 48.400000000000006 66.67500000000001 48.400000000000006Q70.325 48.400000000000006 71.86250000000001 49.487500000000004Q73.4 50.575 73.7625 52.3125Q74.125 54.050000000000004 74.125 56.075V90.875Q74.125 92.80000000000001 73.7625 94.53750000000001Q73.4 96.275 71.85000000000001 97.3125Q70.30000000000001 98.35000000000001 66.575 98.35000000000001Z"/><path d="M106.125 98.35000000000001Q101.025 98.35000000000001 97.3375 97.25Q93.65 96.15 91.2625 93.85000000000001Q88.875 91.55000000000001 87.7375 87.98750000000001Q86.6 84.42500000000001 86.6 79.55000000000001V38.95Q86.6 36.925000000000004 86.9625 35.300000000000004Q87.325 33.675000000000004 88.9 32.66250000000001Q90.475 31.650000000000006 94.1 31.650000000000006Q97.675 31.650000000000006 99.26249999999999 32.72500000000001Q100.85 33.800000000000004 101.225 35.525000000000006Q101.6 37.25 101.6 39.175000000000004V78.92500000000001Q101.6 80.525 101.85 81.55000000000001Q102.1 82.575 102.6125 83.1Q103.125 83.625 104.0 83.8375Q104.875 84.05000000000001 106.175 84.05000000000001Q108.425 84.05000000000001 110.125 84.41250000000001Q111.82499999999999 84.775 112.76249999999999 86.2Q113.69999999999999 87.625 113.69999999999999 90.9Q113.69999999999999 94.55000000000001 112.57499999999999 96.125Q111.44999999999999 97.7 109.71249999999999 98.025Q107.975 98.35000000000001 106.125 98.35000000000001ZM83.475 49.1 94.475 49.150000000000006 108.3 48.725Q110.225 48.725 111.925 49.087500000000006Q113.625 49.45 114.7125 51.025000000000006Q115.8 52.6 115.8 56.300000000000004Q115.8 59.725 114.725 61.3125Q113.65 62.900000000000006 111.9625 63.337500000000006Q110.275 63.775000000000006 108.275 63.775000000000006L95.225 63.50000000000001L83.125 63.550000000000004Q80.175 63.400000000000006 79.05 61.737500000000004Q77.925 60.075 77.925 56.225Q77.925 52.625 79.3 50.8625Q80.675 49.1 83.475 49.1Z"/><path d="M146.22500000000002 98.35000000000001Q141.125 98.35000000000001 137.4375 97.25Q133.75 96.15 131.3625 93.85000000000001Q128.975 91.55000000000001 127.8375 87.98750000000001Q126.7 84.42500000000001 126.7 79.55000000000001V38.95Q126.7 36.925000000000004 127.0625 35.300000000000004Q127.42500000000001 33.675000000000004 129.0 32.66250000000001Q130.57500000000002 31.650000000000006 134.20000000000002 31.650000000000006Q137.775 31.650000000000006 139.3625 32.72500000000001Q140.95000000000002 33.800000000000004 141.32500000000002 35.525000000000006Q141.70000000000002 37.25 141.70000000000002 39.175000000000004V78.92500000000001Q141.70000000000002 80.525 141.95000000000002 81.55000000000001Q142.20000000000002 82.575 142.71250000000003 83.1Q143.22500000000002 83.625 144.10000000000002 83.8375Q144.97500000000002 84.05000000000001 146.275 84.05000000000001Q148.525 84.05000000000001 150.22500000000002 84.41250000000001Q151.925 84.775 152.8625 86.2Q153.8 87.625 153.8 90.9Q153.8 94.55000000000001 152.675 96.125Q151.55 97.7 149.8125 98.025Q148.07500000000002 98.35000000000001 146.22500000000002 98.35000000000001ZM123.575 49.1 134.57500000000002 49.150000000000006 148.4 48.725Q150.32500000000002 48.725 152.02500000000003 49.087500000000006Q153.72500000000002 49.45 154.8125 51.025000000000006Q155.9 52.6 155.9 56.300000000000004Q155.9 59.725 154.825 61.3125Q153.75 62.900000000000006 152.0625 63.337500000000006Q150.375 63.775000000000006 148.375 63.775000000000006L135.32500000000002 63.50000000000001L123.22500000000001 63.550000000000004Q120.275 63.400000000000006 119.15 61.737500000000004Q118.025 60.075 118.025 56.225Q118.025 52.625 119.4 50.8625Q120.775 49.1 123.575 49.1Z"/><path d="M173.65 118.47500000000001Q169.6 116.67500000000001 168.9375 114.47500000000001Q168.275 112.275 170.025 108.65L195.07500000000002 52.550000000000004Q196.82500000000002 48.625 198.83750000000003 47.85Q200.85000000000002 47.075 204.97500000000002 48.75Q208.95000000000002 50.575 209.63750000000002 52.675000000000004Q210.32500000000002 54.775000000000006 208.72500000000002 58.300000000000004L183.5 114.825Q181.82500000000002 118.75 179.8 119.5125Q177.775 120.275 173.65 118.47500000000001ZM182.35000000000002 95.2 158.875 59.45Q156.70000000000002 56.1 157.125 53.8875Q157.55 51.675000000000004 161.1 49.45Q164.975 47.050000000000004 167.125 47.587500000000006Q169.275 48.125 171.525 51.550000000000004L188.8 78.05000000000001Z"/><path d="M238.425 98.72500000000001Q236.0 98.72500000000001 234.275 97.82500000000002Q232.55 96.92500000000001 231.60000000000002 95.025L213.625 59.12500000000001Q211.8 55.475 212.53750000000002 53.125Q213.275 50.775000000000006 217.05 48.95Q220.875 47.075 223.1375 47.6625Q225.4 48.25 227.20000000000002 52.35L238.425 78.42500000000001L249.57500000000002 52.675000000000004Q251.45000000000002 48.425000000000004 253.6875 47.7Q255.925 46.975 259.925 48.975Q263.975 50.95 264.4375 53.462500000000006Q264.90000000000003 55.975 263.20000000000005 59.325L245.275 95.0Q244.35000000000002 96.875 242.65000000000003 97.80000000000001Q240.95000000000002 98.72500000000001 238.425 98.72500000000001Z" fill-opacity="0.5"/><path d="M291.59999999999997 99.22500000000001Q284.59999999999997 99.22500000000001 279.5625 96.9375Q274.525 94.65 271.3125 90.86250000000001Q268.09999999999997 87.075 266.525 82.5Q264.95 77.92500000000001 264.95 73.325Q264.95 65.775 268.35 59.97500000000001Q271.75 54.175000000000004 277.775 50.862500000000004Q283.8 47.550000000000004 291.575 47.550000000000004Q297.375 47.550000000000004 301.625 49.400000000000006Q305.875 51.25 308.6375 54.175Q311.4 57.1 312.7625 60.5Q314.125 63.900000000000006 314.125 66.97500000000001Q314.125 72.47500000000001 311.4625 75.16250000000001Q308.8 77.85000000000001 304.7 77.85000000000001H280.84999999999997Q281.09999999999997 80.375 282.75 82.1875Q284.4 84.0 286.9125 85.0Q289.425 86.0 292.175 86.0Q294.55 86.0 296.3625 85.73750000000001Q298.175 85.47500000000001 299.5 85.03750000000001Q300.825 84.60000000000001 301.8875 84.16250000000001Q302.95 83.72500000000001 303.8125 83.4Q304.675 83.075 305.475 83.0Q306.95 82.95 308.23749999999995 83.86250000000001Q309.525 84.775 310.5 86.7Q311.15 87.85000000000001 311.42499999999995 88.85000000000001Q311.7 89.85000000000001 311.7 90.775Q311.7 93.25 309.2625 95.1375Q306.825 97.025 302.35 98.125Q297.875 99.22500000000001 291.59999999999997 99.22500000000001ZM280.84999999999997 69.60000000000001H296.7Q298.25 69.60000000000001 299.0125 69.03750000000001Q299.775 68.47500000000001 299.775 66.95Q299.775 65.15 298.7 63.78750000000001Q297.625 62.425000000000004 295.775 61.66250000000001Q293.925 60.900000000000006 291.45 60.900000000000006Q288.4 60.900000000000006 285.98749999999995 62.112500000000004Q283.575 63.325 282.23749999999995 65.30000000000001Q280.9 67.275 280.84999999999997 69.60000000000001Z" fill-opacity="0.5"/><path d="M326.95000000000005 98.35000000000001Q323.32500000000005 98.35000000000001 321.75 97.26250000000002Q320.175 96.17500000000001 319.85 94.38750000000002Q319.52500000000003 92.60000000000001 319.52500000000003 90.67500000000001V55.800000000000004Q319.52500000000003 53.775000000000006 319.88750000000005 52.075Q320.25000000000006 50.375 321.82500000000005 49.35Q323.40000000000003 48.325 327.05 48.325Q330.6 48.325 332.15000000000003 49.275000000000006Q333.70000000000005 50.225 334.07500000000005 51.475Q334.45000000000005 52.725 334.45000000000005 53.625L333.25000000000006 54.225Q333.50000000000006 53.800000000000004 334.35 52.775000000000006Q335.20000000000005 51.75 336.71250000000003 50.587500000000006Q338.225 49.425000000000004 340.35 48.60000000000001Q342.475 47.775000000000006 345.27500000000003 47.775000000000006Q346.35 47.775000000000006 347.70000000000005 47.962500000000006Q349.05 48.150000000000006 350.5 48.575Q351.95000000000005 49.0 353.1625 49.75Q354.37500000000006 50.5 355.11250000000007 51.625Q355.85 52.75 355.85 54.325Q355.85 58.400000000000006 353.96250000000003 61.25Q352.07500000000005 64.1 349.225 64.1Q347.52500000000003 64.1 346.7875 63.825Q346.05 63.550000000000004 345.63750000000005 63.237500000000004Q345.225 62.925000000000004 344.58750000000003 62.650000000000006Q343.95000000000005 62.37500000000001 342.425 62.37500000000001Q340.925 62.37500000000001 339.5375 62.800000000000004Q338.15000000000003 63.225 337.02500000000003 64.075Q335.90000000000003 64.92500000000001 335.25 66.16250000000001Q334.6 67.4 334.6 68.95V90.875Q334.6 92.80000000000001 334.23750000000007 94.53750000000001Q333.87500000000006 96.275 332.2875 97.3125Q330.70000000000005 98.35000000000001 326.95000000000005 98.35000000000001Z" fill-opacity="0.5"/><path d="M376.575 99.10000000000001Q373.9 99.10000000000001 370.725 98.5Q367.55 97.9 364.57500000000005 96.75Q361.6 95.60000000000001 359.57500000000005 94.03750000000001Q357.55 92.47500000000001 357.275 90.47500000000001Q357.1 89.47500000000001 357.3625 88.36250000000001Q357.625 87.25 358.2875 85.975Q358.95 84.7 360.025 83.30000000000001Q360.825 82.25 361.7875 81.92500000000001Q362.75 81.60000000000001 364.125 82.025Q365.7 82.275 367.325 83.05000000000001Q368.95 83.825 370.625 84.6875Q372.3 85.55000000000001 374.0875 86.1875Q375.875 86.825 377.8 86.825Q380.6 86.825 382.1625 85.98750000000001Q383.725 85.15 383.725 83.625Q383.725 82.55000000000001 383.0625 81.8125Q382.4 81.075 381.23749999999995 80.5625Q380.075 80.05000000000001 378.5625 79.63750000000002Q377.05 79.22500000000001 375.3125 78.78750000000001Q373.575 78.35000000000001 371.75 77.775Q369.325 77.075 366.98749999999995 76.0Q364.65 74.92500000000001 362.7875 73.17500000000001Q360.925 71.42500000000001 359.8 68.875Q358.675 66.325 358.675 62.575Q358.675 57.725 360.9625 54.400000000000006Q363.25 51.075 367.65 49.325Q372.05 47.575 378.375 47.575Q380.225 47.575 382.0 47.8125Q383.775 48.050000000000004 385.525 48.525000000000006Q387.275 49.0 388.975 49.725Q390.675 50.45 392.35 51.375Q395.425 52.85 395.525 55.212500000000006Q395.625 57.575 393.775 60.150000000000006Q392.65 61.825 391.4625 62.575Q390.275 63.325 389.025 63.050000000000004Q387.425 62.650000000000006 385.5625 61.737500000000004Q383.7 60.825 381.6625 60.025000000000006Q379.625 59.225 377.55 59.225Q375.925 59.225 374.7125 59.650000000000006Q373.5 60.075 372.8875 60.85000000000001Q372.275 61.62500000000001 372.275 62.650000000000006Q372.275 63.900000000000006 373.04999999999995 64.67500000000001Q373.825 65.45 375.11249999999995 65.95Q376.4 66.45 378.11249999999995 66.825Q379.825 67.2 381.775 67.575Q384.475 68.075 387.3125 68.95Q390.15 69.825 392.5125 71.4125Q394.875 73.0 396.325 75.725Q397.775 78.45 397.775 82.825Q397.775 90.7 392.275 94.9Q386.775 99.10000000000001 376.575 99.10000000000001Z" fill-opacity="0.5"/><path d="M428.2 99.22500000000001Q421.2 99.22500000000001 416.1625 96.9375Q411.125 94.65 407.9125 90.86250000000001Q404.7 87.075 403.125 82.5Q401.55 77.92500000000001 401.55 73.325Q401.55 65.775 404.95000000000005 59.97500000000001Q408.35 54.175000000000004 414.375 50.862500000000004Q420.40000000000003 47.550000000000004 428.175 47.550000000000004Q433.975 47.550000000000004 438.225 49.400000000000006Q442.475 51.25 445.2375 54.175Q448.0 57.1 449.3625 60.5Q450.725 63.900000000000006 450.725 66.97500000000001Q450.725 72.47500000000001 448.0625 75.16250000000001Q445.40000000000003 77.85000000000001 441.3 77.85000000000001H417.45Q417.7 80.375 419.35 82.1875Q421.0 84.0 423.51250000000005 85.0Q426.02500000000003 86.0 428.77500000000003 86.0Q431.15000000000003 86.0 432.96250000000003 85.73750000000001Q434.77500000000003 85.47500000000001 436.1 85.03750000000001Q437.425 84.60000000000001 438.4875 84.16250000000001Q439.55 83.72500000000001 440.4125 83.4Q441.27500000000003 83.075 442.07500000000005 83.0Q443.55 82.95 444.8375 83.86250000000001Q446.125 84.775 447.1 86.7Q447.75 87.85000000000001 448.025 88.85000000000001Q448.3 89.85000000000001 448.3 90.775Q448.3 93.25 445.8625 95.1375Q443.425 97.025 438.95000000000005 98.125Q434.475 99.22500000000001 428.2 99.22500000000001ZM417.45 69.60000000000001H433.3Q434.85 69.60000000000001 435.6125 69.03750000000001Q436.375 68.47500000000001 436.375 66.95Q436.375 65.15 435.3 63.78750000000001Q434.225 62.425000000000004 432.375 61.66250000000001Q430.52500000000003 60.900000000000006 428.05 60.900000000000006Q425.0 60.900000000000006 422.5875 62.112500000000004Q420.175 63.325 418.8375 65.30000000000001Q417.5 67.275 417.45 69.60000000000001Z" fill-opacity="0.5"/><path transform="translate(50.85 10.25) scale(1.2500)" d="M12 21s-9-5.6-9-12.2A5 5 0 0 1 12 5.6 5 5 0 0 1 21 8.8C21 15.4 12 21 12 21z"/><g transform="translate(166.50 49.44) scale(1.4000)"><ellipse cx="50" cy="20" rx="46" ry="12" fill="none" stroke="currentColor" stroke-width="3.6" stroke-opacity="0.5" transform="rotate(-14 50 20)"/></g></svg>';
  const MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 132 132" fill="currentColor" role="img" aria-label="VittyVerse"><path d="M51.286 84.60600000000001Q49.928 84.60600000000001 48.962 84.102Q47.996 83.598 47.464 82.534L37.398 62.43000000000001Q36.376000000000005 60.386 36.789 59.07000000000001Q37.202 57.754000000000005 39.316 56.732Q41.458 55.682 42.725 56.011Q43.992000000000004 56.34 45.0 58.636L51.286 73.238L57.53 58.818000000000005Q58.58 56.438 59.833 56.032000000000004Q61.086 55.626000000000005 63.326 56.746Q65.594 57.852000000000004 65.853 59.259Q66.112 60.666000000000004 65.16 62.542L55.122 82.52000000000001Q54.604 83.57000000000001 53.652 84.08800000000001Q52.7 84.60600000000001 51.286 84.60600000000001Z"/><path d="M81.75 84.60600000000001Q80.392 84.60600000000001 79.426 84.102Q78.46000000000001 83.598 77.928 82.534L67.862 62.43000000000001Q66.84 60.386 67.253 59.07000000000001Q67.666 57.754000000000005 69.78 56.732Q71.922 55.682 73.189 56.011Q74.456 56.34 75.464 58.636L81.75 73.238L87.994 58.818000000000005Q89.044 56.438 90.297 56.032000000000004Q91.55 55.626000000000005 93.78999999999999 56.746Q96.05799999999999 57.852000000000004 96.317 59.259Q96.576 60.666000000000004 95.624 62.542L85.586 82.52000000000001Q85.068 83.57000000000001 84.116 84.08800000000001Q83.164 84.60600000000001 81.75 84.60600000000001Z" fill-opacity="0.5"/><g transform="translate(24.00 49.20) scale(0.8400)"><ellipse cx="50" cy="20" rx="46" ry="12" fill="none" stroke="currentColor" stroke-width="3.2" stroke-opacity="0.5" transform="rotate(-14 50 20)"/><path transform="translate(83.5 4.3) scale(0.65)" d="M12 21s-9-5.6-9-12.2A5 5 0 0 1 12 5.6 5 5 0 0 1 21 8.8C21 15.4 12 21 12 21z" fill="currentColor" fill-opacity="0.5"/></g></svg>';
  // logo:end
  // House rule: every app's Settings ends with "Made with ♥ by VittyVerse", above the credits (Splitter, which
  // has no Settings, at the foot of its Bills screen). The support link shows only once COFFEE_URL is set, and never
  // in a native App Store build (window.Capacitor), where Apple allows tips only through in-app purchase.
  const COFFEE_URL = "";
  function madeWith() {
    const coffee = COFFEE_URL && !window.Capacitor
      ? `<a class="btn small pill vv-coffee" href="${COFFEE_URL}" target="_blank" rel="noopener"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8zM17 9h1.5a2.5 2.5 0 0 1 0 5H17M8 2v3M12 2v3"/></svg>Buy me a coffee</a>`
      : "";
    return `<div class="vv-made"><span>Made with ♥︎ by</span>${LOGO}${coffee}</div>`;
  }
  // In a page's own markup, <span data-vv="logo"></span> and <span data-vv="mark"></span> get the logo and the mark.
  function fillLogos() {
    document.querySelectorAll('[data-vv="logo"]').forEach((el) => { el.innerHTML = LOGO; });
    document.querySelectorAll('[data-vv="mark"]').forEach((el) => { el.innerHTML = MARK; });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fillLogos); else fillLogos();

  // ---------- feedback: changes you can see ----------
  // When something changes, the thing that changed says so, briefly: VV.enter(el) for a new row (it rises in),
  // VV.flash(el) for a row whose contents changed (a short glow in the app's accent), VV.pulse(el) for a number that
  // changed (a small bump). Calling one again restarts it; with "Reduce motion" nothing moves.
  function play(el, cls) {
    if (!el || reduced()) return;
    el.classList.remove(cls);
    void el.offsetWidth;   // restart the animation if it's already running
    el.classList.add(cls);
    el.addEventListener("animationend", () => el.classList.remove(cls), { once: true });
  }
  const enter = (el) => play(el, "vv-enter"), flash = (el) => play(el, "vv-flash"), pulse = (el) => play(el, "vv-pulse");

  // ---------- where something stands ----------
  // Every status in every app's Settings reads the same way: a small coloured pill saying where it stands, then the
  // detail. VV.state(kind, label, detail) -> HTML. Kinds: "ok" (done: connected, ready, downloaded, synced), "off" (not
  // set up yet, by choice: not set, not downloaded), "warn" (needs you: not working, unreachable, not set up) and
  // "busy" (under way: checking, syncing, downloading).
  const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const state = (kind, label, detail = "") =>
    `<span class="vv-state ${escapeHtml(kind)}">${escapeHtml(label)}</span>${detail ? `<span class="vv-state-detail">${escapeHtml(detail)}</span>` : ""}`;

  // ---------- hold for options ----------
  // Holding an item (a show, an episode) opens its own options, never the browser's menu for its picture (Share, Save
  // to Photos): VV.hold(el, fn). A right-click does the same with a mouse. The tap that ends a hold doesn't also count.
  function hold(el, fn, ms = 480) {
    el.classList.add("vv-holdable");
    let timer = 0, x = 0, y = 0, held = false;
    const cancel = () => { clearTimeout(timer); el.classList.remove("vv-holding"); };
    el.addEventListener("pointerdown", (e) => {
      if (e.button) return;
      held = false;
      x = e.clientX; y = e.clientY;
      el.classList.add("vv-holding");
      timer = setTimeout(() => { held = true; el.classList.remove("vv-holding"); fn(e); }, ms);
    });
    el.addEventListener("pointermove", (e) => { if (Math.hypot(e.clientX - x, e.clientY - y) > 10) cancel(); });
    el.addEventListener("pointerup", cancel);
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("pointerleave", cancel);
    el.addEventListener("click", (e) => { if (held) { e.preventDefault(); e.stopImmediatePropagation(); held = false; } }, true);
    el.addEventListener("contextmenu", (e) => { e.preventDefault(); if (!held) { cancel(); fn(e); } });
  }

  // ---------- pull to refresh ----------
  // A screen whose contents come from somewhere else refreshes when you pull it down from the top, as lists do on
  // iPhone: VV.pullToRefresh(el, refresh, { when }). `refresh` returns a promise, and the spinner turns until it
  // settles; `when()` says whether the screen showing now can be pulled (not a player, not with a sheet open).
  function pullToRefresh(el, refresh, opts = {}) {
    const PULL = 70, MAX = 120;
    const ring = document.createElement("div");
    ring.className = "vv-ptr";
    ring.setAttribute("aria-hidden", "true");
    ring.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';
    el.classList.add("vv-ptr-host");
    el.prepend(ring);
    let y0 = null, pull = 0, busy = false;
    const show = (d) => {
      ring.style.transform = `translateY(${d - 52}px) rotate(${d * 3}deg)`;
      ring.style.opacity = String(Math.min(1, d / PULL));
      ring.classList.toggle("armed", d >= PULL);
    };
    const reset = () => { ring.classList.remove("spin", "armed", "drag"); ring.style.transform = ""; ring.style.opacity = ""; };
    document.addEventListener("touchstart", (e) => {
      y0 = !busy && e.touches.length === 1 && scrollY <= 0 && el.contains(e.target) && !document.querySelector(".scrim")
        && (!opts.when || opts.when()) ? e.touches[0].clientY : null;
      pull = 0;
    }, { passive: true });
    document.addEventListener("touchmove", (e) => {
      if (y0 == null) return;
      const dy = e.touches[0].clientY - y0;
      if (dy <= 0 || scrollY > 0) { if (pull) { pull = 0; reset(); } return; }
      e.preventDefault();   // the page stays put while you pull
      pull = Math.min(MAX, dy * 0.5);
      ring.classList.add("drag");
      show(pull);
    }, { passive: false });
    document.addEventListener("touchend", () => {
      if (y0 == null) return;
      y0 = null;
      ring.classList.remove("drag");
      if (pull < PULL) { reset(); return; }
      busy = true;
      ring.classList.add("spin");
      ring.style.transform = "translateY(18px)";
      ring.style.opacity = "1";
      Promise.resolve().then(refresh).catch(() => {}).finally(() => { busy = false; reset(); });
    });
    return ring;
  }

  window.VV = { swap, dismiss, keep, noZoom, reduced, themeControl, setTheme, isDark, glassControl, appearanceControl, glass: glassNow, setGlass, logo: () => LOGO, mark: () => MARK, madeWith, enter, flash, pulse, pullToRefresh, hold, state };
})();
