// lib/heuristic.js
// Pure scoring function. No I/O. Same code path for tab-level and
// page-level scoring. Exposed on globalThis.__th so the service worker
// and the content script can both use it (MV3 content scripts share
// the isolated world with lib scripts listed in the manifest).

(function (global) {
  "use strict";

  // Points per signal. Sum of these determines a tab's "waste score".
  // Discard threshold is DISCARD_THRESHOLD.
  const POINTS = {
    AUDIBLE_NOT_ACTIVE: 30,
    INACTIVE_LONG: 20,
    DISCARDABLE_BASELINE: 5,
    LONG_TASKS_HIGH: 25,
    WS_RECONNECTS_HIGH: 20,
    AUDIO_NO_VIDEO: 15,
    LAYOUT_THRASH_HIGH: 10,
  };

  const DISCARD_THRESHOLD = 60;
  const TAB_COUNT_MULTIPLIER_THRESHOLD = 20;
  const TAB_COUNT_MULTIPLIER = 1.5;
  const INACTIVE_MINUTES = 10;
  const AUDIBLE_MINUTES = 5;
  // Counters in the content script are reported per 60s window.
  const LONG_TASKS_THRESHOLD = 5;
  const WS_RECONNECTS_THRESHOLD = 3;
  const LAYOUT_SHIFTS_THRESHOLD = 10;

  function isNeverDiscardable(url) {
    if (!url) return true;
    return /^chrome:|^about:|^chrome-extension:|^edge:|^devtools:/.test(url);
  }

  /**
   * Tab-level score. pageSignals may be null/undefined.
   * @param {{
   *   audible: boolean,
   *   active: boolean,
   *   lastAccessedMinutes: number,
   *   discarded: boolean,
   *   autoDiscardable: boolean,
   *   pinned: boolean,
   *   url: string,
   *   totalTabs: number,
   *   audibleMinutes?: number,
   * }} tab
   * @param {{
   *   longTasks: number,
   *   wsReconnects: number,
   *   audioNoVideo: boolean,
   *   layoutShifts: number,
   * }|null|undefined} pageSignals
   * @returns {{score: number, eligible: boolean, reasons: string[]}}
   */
  function scoreTab(tab, pageSignals) {
    const reasons = [];
    let score = 0;

    if (tab.audible && !tab.active && (tab.audibleMinutes || 0) >= AUDIBLE_MINUTES) {
      score += POINTS.AUDIBLE_NOT_ACTIVE;
      reasons.push("audible_inactive");
    }
    if (!tab.active && tab.lastAccessedMinutes >= INACTIVE_MINUTES) {
      score += POINTS.INACTIVE_LONG;
      reasons.push("inactive_long");
    }
    if (!tab.discarded && tab.autoDiscardable) {
      score += POINTS.DISCARDABLE_BASELINE;
      reasons.push("discardable");
    }

    if (pageSignals) {
      if (pageSignals.longTasks > LONG_TASKS_THRESHOLD) {
        score += POINTS.LONG_TASKS_HIGH;
        reasons.push("long_tasks");
      }
      if (pageSignals.wsReconnects > WS_RECONNECTS_THRESHOLD) {
        score += POINTS.WS_RECONNECTS_HIGH;
        reasons.push("ws_reconnects");
      }
      if (pageSignals.audioNoVideo) {
        score += POINTS.AUDIO_NO_VIDEO;
        reasons.push("audio_no_video");
      }
      if (pageSignals.layoutShifts > LAYOUT_SHIFTS_THRESHOLD) {
        score += POINTS.LAYOUT_THRASH_HIGH;
        reasons.push("layout_thrash");
      }
    }

    if (tab.totalTabs > TAB_COUNT_MULTIPLIER_THRESHOLD) {
      score = Math.round(score * TAB_COUNT_MULTIPLIER);
      reasons.push("high_tab_count");
    }

    const eligible =
      score >= DISCARD_THRESHOLD &&
      !tab.pinned &&
      !tab.active &&
      tab.autoDiscardable &&
      !tab.discarded &&
      !isNeverDiscardable(tab.url);

    return { score, eligible, reasons };
  }

  global.__th = {
    POINTS,
    DISCARD_THRESHOLD,
    isNeverDiscardable,
    scoreTab,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
