// lib/demo.js
// Synthesizes one year of discard data that totals exactly €17.26.
// Used for screenshots and demos only — flagged with isDemoData=true
// so the UI can warn the user.
//
// Usage from service worker:
//   const { ok, count } = await globalThis.__td.seedDemoData();
//   const { ok } = await globalThis.__td.resetData();

(function (global) {
  "use strict";

  // Must match the constants in lib/impact.js
  const W = 0.5;
  const EUR = 0.40;
  const H = 4;
  const PER_DISCARD_EUR = (W * H / 1000) * EUR; // 0.0008
  const PER_DISCARD_WH = W * H;                 // 2

  const TARGET_EUR = 17.26;
  const TOTAL_DISCARDS = Math.round(TARGET_EUR / PER_DISCARD_EUR);
  const DAYS = 365;
  const WEEKEND_FACTOR = 0.6;

  function ymd(d) {
    return d.toISOString().slice(0, 10);
  }

  /**
   * Generate and write ~1 year of synthetic discard data.
   * Overwrites any existing discardLog and dailyTotals.
   * @returns {Promise<{ok: boolean, discards: number}>}
   */
  async function seedDemoData() {
    // Build dailyTotals for the last 365 days. Distribute TOTAL_DISCARDS
    // across days with weekday/weekend weighting so the curve looks
    // plausible. Per-day Wh = discards * PER_DISCARD_WH.
    const dailyTotals = {};
    let totalWeighted = 0;
    const weights = [];
    const today = new Date();
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - (DAYS - 1 - i));
      const dow = d.getDay();
      const isWeekend = dow === 0 || dow === 6;
      const w = isWeekend ? WEEKEND_FACTOR : 1.0;
      weights.push(w);
      totalWeighted += w;
    }
    const basePerWeekday = TOTAL_DISCARDS / totalWeighted;

    for (let i = 0; i < DAYS; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - (DAYS - 1 - i));
      const day = ymd(d);
      const discards = Math.max(0, Math.round(weights[i] * basePerWeekday));
      // Add small per-day jitter so it doesn't look perfectly uniform.
      const jitter = ((i * 17) % 7) - 3; // -3..+3
      const final = Math.max(0, discards + jitter);
      dailyTotals[day] = {
        wh: final * PER_DISCARD_WH,
        eur: final * PER_DISCARD_EUR,
      };
    }

    // Build a representative discardLog: keep it to the last 200 events
    // so storage stays bounded. Synthesize 200 events spread across the
    // last 14 days with realistic domain names.
    const DOMAINS = [
      "github.com", "stackoverflow.com", "news.ycombinator.com",
      "twitter.com", "reddit.com", "docs.google.com",
      "figma.com", "notion.so", "slack.com", "youtube.com",
      "wikipedia.org", "medium.com", "linkedin.com", "mail.google.com",
      "calendar.google.com", "drive.google.com", "console.cloud.google.com",
      "aws.amazon.com", "vercel.com", "developer.mozilla.org",
    ];
    const discardLog = [];
    const now = Date.now();
    for (let i = 0; i < 200; i++) {
      const ageDays = (i / 200) * 14; // spread over last 14 days
      const ts = now - ageDays * 24 * 3600 * 1000;
      const domain = DOMAINS[i % DOMAINS.length];
      discardLog.push({
        ts,
        tabId: 1000 + i,
        url: `https://${domain}/some/path/${i}`,
        score: 40 + (i % 30),
        reasons: ["inactive_long", "discardable"],
        wh: PER_DISCARD_WH,
        eur: PER_DISCARD_EUR,
        restored: i % 7 === 0, // ~14% restored
        isDemo: true,
      });
    }

    await chrome.storage.local.set({
      dailyTotals,
      discardLog,
      isDemoData: true,
      demoDataSeededAt: now,
    });

    return { ok: true, discards: TOTAL_DISCARDS };
  }

  /**
   * Wipe all TabSleep data. Idempotent.
   * @returns {Promise<{ok: boolean}>}
   */
  async function resetData() {
    await chrome.storage.local.remove([
      "discardLog",
      "dailyTotals",
      "isDemoData",
      "demoDataSeededAt",
    ]);
    // In-memory cache too
    ourDiscards = new Map();
    return { ok: true };
  }

  global.__td = {
    seedDemoData,
    resetData,
    constants: {
      TARGET_EUR,
      TOTAL_DISCARDS,
      DAYS,
      PER_DISCARD_EUR,
      PER_DISCARD_WH,
    },
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
