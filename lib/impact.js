// lib/impact.js
// Pure impact calculation. No I/O. Exposed on globalThis.__ti.
// Centralized so the assumption constants live in exactly one place.

(function (global) {
  "use strict";

  // Power saved per discarded tab while it's sleeping.
  // Conservative estimate: real CPU-heavy tabs draw 0.1-0.5 W,
  // idle tabs 0.02-0.05 W. We use the lower bound to stay honest.
  // Single source of truth — change here to retune everywhere.
  const WATT_PER_DISCARDED_TAB = 0.05;

  // Germany 2024 grid average (DESTATIS): ~380 g CO2e per kWh.
  // Conservative mix. Update yearly in a single edit if you want
  // to keep the number fresh.
  const G_CO2E_PER_KWH = 380;

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
   * g CO2e for a given kWh amount.
   * @param {number} kwh
   * @returns {number} grams
   */
  function gCO2e(kwh) {
    return kwh * G_CO2E_PER_KWH * 1000;
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
   * Estimate per-discard: assumes ASSUMED_SLEEP_HOURS by default.
   * @param {number} [sleepHours]
   * @returns {{wh: number, gCO2e: number}}
   */
  function estimatePerDiscard(sleepHours) {
    const hours = sleepHours || ASSUMED_SLEEP_HOURS;
    const ms = hours * 3600 * 1000;
    return { wh: whSavedMs(ms), gCO2e: gCO2e(kwhSavedMs(ms)) };
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
    G_CO2E_PER_KWH,
    ASSUMED_SLEEP_HOURS,
    kwhSavedMs,
    whSavedMs,
    gCO2e,
    estimatePerDiscard,
    ledEquivalentMinutes,
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
