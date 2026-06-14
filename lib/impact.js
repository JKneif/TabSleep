// lib/impact.js
// Pure impact calculation. No I/O. Exposed on globalThis.__ti.
// Centralized so the assumption constants live in exactly one place.

(function (global) {
  "use strict";

  // v0.2: power model made *aggressive* per user preference.
  // Real CPU-heavy tabs draw 0.1-0.5 W while idle-in-background;
  // JS-busy tabs can spike higher. We use the upper end of the
  // realistic range so the savings number feels meaningful.
  // If you disagree, change WATT_PER_DISCARDED_TAB in one place.
  const WATT_PER_DISCARDED_TAB = 0.5;

  // v0.2: money model replaces the previous CO2 model.
  // German household electricity price 2024, BDEW Mittelwert:
  // 0.40 EUR per kWh (covers all Umlagen + Steuern + Netzentgelt).
  // For your local tariff, edit this constant. Single source of truth.
  const EUR_PER_KWH = 0.40;

  // Optimistic assumed sleep duration per discard.
  // If the user actually restores the tab earlier, the next tick
  // (background/service-worker.js) caps the actual time at this
  // value, so the daily total never exceeds what we promised.
  const ASSUMED_SLEEP_HOURS = 8;

  /**
   * kWh saved for a given sleep duration in milliseconds.
   * @param {number} ms
   * @returns {number} kWh
   */
  function kwhSavedMs(ms) {
    const hours = ms / 1000 / 3600;
    return (WATT_PER_DISCARDED_TAB * hours) / 1000;
  }

  /**
   * Wh saved for a tab that has been sleeping for `ms`.
   * @param {number} ms
   * @returns {number} Wh
   */
  function whSavedMs(ms) {
    return kwhSavedMs(ms) * 1000;
  }

  /**
   * EUR saved for a given kWh amount.
   * @param {number} kwh
   * @returns {number} EUR
   */
  function eurSaved(kwh) {
    return kwh * EUR_PER_KWH;
  }

  /**
   * Estimate per-discard: assumes ASSUMED_SLEEP_HOURS by default.
   * @param {number} [sleepHours]
   * @returns {{wh: number, eur: number}}
   */
  function estimatePerDiscard(sleepHours) {
    const hours = sleepHours || ASSUMED_SLEEP_HOURS;
    const ms = hours * 3600 * 1000;
    return { wh: whSavedMs(ms), eur: eurSaved(kwhSavedMs(ms)) };
  }

  /**
   * "Relatable" comparison: 1W LED equivalent minutes.
   * @param {number} wh
   * @returns {number} minutes
   */
  function ledEquivalentMinutes(wh) {
    // 1W LED over X minutes = X/60 Wh
    return Math.round((wh / 1) * 60);
  }

  global.__ti = {
    WATT_PER_DISCARDED_TAB,
    EUR_PER_KWH,
    ASSUMED_SLEEP_HOURS,
    kwhSavedMs,
    whSavedMs,
    eurSaved,
    estimatePerDiscard,
    ledEquivalentMinutes,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
