// Shared VittyVerse behaviour, loaded by every page (home, Splitter.ino, Gymmer.ino, Shior.ino) before the app's own code.
// - No zooming anywhere: no pinch, no double-tap. iPhone Safari ignores the viewport's user-scalable=no,
//   so its pinch gestures are stopped here; double-tap zoom is off through touch-action in the stylesheet.
// - Motion: the floating tab bar's pill slides to the tab you pick, views cross-fade when you change section,
//   and sheets slide away instead of vanishing. All of it stays still with "Reduce motion" on.
// - The tab bar can be dragged: slide a finger along it and the lens follows, and the section under the finger opens
//   as you go, like the tab bars in Apple's own apps.
// - Every bottom sheet (.sheet) swipes down to close, in every app.
// Exposed as window.VV for the apps: VV.swap(update), VV.dismiss(el, done), VV.keep(el), VV.noZoom(doc).
(function () {
  "use strict";
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---------- no zoom ----------
  function noZoom(doc) {
    ["gesturestart", "gesturechange", "gestureend"].forEach((t) => doc.addEventListener(t, (e) => e.preventDefault(), { passive: false }));
    doc.addEventListener("touchmove", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  }
  noZoom(document);

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

  window.VV = { swap, dismiss, keep, noZoom, reduced };
})();
