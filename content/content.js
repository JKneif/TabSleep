// content/content.js
// In-page measurement. Runs in the page's isolated world (the
// service worker and the lib scripts share that world via the
// manifest's content_scripts.js array — importScripts is only
// available in the service worker, not the content script).
//
// We don't have importScripts in content scripts, so we duplicate
// the lib scripts' globalThis attachments. In MV3 the content_scripts
// array lists each JS file in order, so the lib files run before
// this one and attach __th / __ti to the same global.

(function () {
  "use strict";

  // 60s measurement windows.
  const WINDOW_MS = 60_000;
  const POST_INTERVAL_MS = 30_000;

  // Counters reset on a rolling window.
  const counters = {
    longTasks: 0,
    wsReconnects: 0,
    layoutShifts: 0,
  };
  let lastReset = Date.now();

  function maybeResetCounters() {
    const now = Date.now();
    if (now - lastReset >= WINDOW_MS) {
      counters.longTasks = 0;
      counters.wsReconnects = 0;
      counters.layoutShifts = 0;
      lastReset = now;
    }
  }

  function setupLongTaskObserver() {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      const obs = new PerformanceObserver((list) => {
        maybeResetCounters();
        for (const _ of list.getEntries()) counters.longTasks += 1;
      });
      obs.observe({ entryTypes: ["longtask"] });
    } catch (e) {
      /* longtask may not be supported */
    }
  }

  function setupLayoutShiftObserver() {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      const obs = new PerformanceObserver((list) => {
        maybeResetCounters();
        for (const entry of list.getEntries()) {
          if (!entry.hadRecentInput) counters.layoutShifts += 1;
        }
      });
      obs.observe({ entryTypes: ["layout-shift"] });
    } catch (e) {
      /* layout-shift may not be supported */
    }
  }

  function setupWebSocketPatch() {
    // Wrap WebSocket.prototype.addEventListener to count 'close' events.
    // Best-effort: third-party code that captures the unpatched proto
    // is on its own. Still catches the common case.
    try {
      const proto = WebSocket.prototype;
      const origAdd = proto.addEventListener;
      proto.addEventListener = function (type, listener, opts) {
        if (type === "close") {
          const wrapped = function (ev) {
            maybeResetCounters();
            counters.wsReconnects += 1;
            return listener.call(this, ev);
          };
          return origAdd.call(this, type, wrapped, opts);
        }
        return origAdd.call(this, type, listener, opts);
      };
    } catch (e) {
      /* prototype may be sealed in some environments */
    }
  }

  function audioNoVideo() {
    // We don't need true AudioContext state — the existence of any
    // visible <video> tag with audio track would matter, but a much
    // stronger and simpler signal is: do we have a playing media
    // element? Use the document's media element state.
    if (typeof document === "undefined") return false;
    const videos = document.querySelectorAll("video, audio");
    for (const v of videos) {
      if (!v.paused && v.readyState >= 2) {
        // It's playing. "No video" only matters if it's in viewport.
        if (typeof v.getBoundingClientRect === "function") {
          const r = v.getBoundingClientRect();
          const inView = r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
          if (!inView) return true;
        }
      }
    }
    return false;
  }

  function postSignals() {
    maybeResetCounters();
    const signals = {
      longTasks: counters.longTasks,
      wsReconnects: counters.wsReconnects,
      audioNoVideo: audioNoVideo(),
      layoutShifts: counters.layoutShifts,
    };
    try {
      chrome.runtime.sendMessage({ type: "PAGE_SIGNALS", signals });
    } catch (e) {
      // SW may be inactive between ticks; ignore.
    }
  }

  setupLongTaskObserver();
  setupLayoutShiftObserver();
  setupWebSocketPatch();
  // Post once at load, then on an interval. Interval is short enough
  // that the SW gets fresh data between ticks.
  postSignals();
  setInterval(postSignals, POST_INTERVAL_MS);
})();
