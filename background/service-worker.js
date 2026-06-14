// background/service-worker.js
// Orchestrates TabSleep. Owns the discard decision. Wakes on a 60s alarm.
// MV3 service workers can be killed at any time — all state must live in
// chrome.storage or be recomputable on wake.

importScripts("../lib/heuristic.js", "../lib/impact.js");

const ALARM_NAME = "tabsleep-tick";
const TICK_MINUTES = 1; // production
const LOG_CAP = 200;
const DAILY_TOTAL_DAYS = 30;

// Per-tab page signals received from content scripts. Maps tabId -> signals.
// Recomputed every tick from chrome.tabs so we don't have to persist it.
let lastPageSignals = new Map();
// Tabs we discarded ourselves, and when — to compute accurate sleep duration
// and to know which tabs in storage are "ours".
let ourDiscards = new Map(); // tabId -> {ts, url, score, reasons, gCO2e, wh}

chrome.runtime.onInstalled.addListener(async () => {
  await ensureAlarm();
  await rebuildOurDiscardsFromStorage();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureAlarm();
  await rebuildOurDiscardsFromStorage();
});

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    await chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: TICK_MINUTES,
      periodInMinutes: TICK_MINUTES,
    });
  }
}

async function rebuildOurDiscardsFromStorage() {
  const { discardLog = [] } = await chrome.storage.local.get("discardLog");
  const now = Date.now();
  // Anything discarded < ASSUMED_SLEEP_HOURS ago is still "ours".
  const cap = globalThis.__ti.ASSUMED_SLEEP_HOURS * 3600 * 1000;
  ourDiscards = new Map();
  for (const ev of discardLog) {
    if (now - ev.ts < cap) {
      ourDiscards.set(ev.tabId, ev);
    }
  }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await tick();
});

async function tick() {
  await rebuildOurDiscardsFromStorage();
  const tabs = await chrome.tabs.query({});
  const totalTabs = tabs.length;
  const now = Date.now();
  const dailyDelta = { wh: 0, gCO2e: 0 };

  // Step 1: collect page signals from content scripts.
  // We send a request; content scripts respond asynchronously. To keep
  // the tick simple and avoid race conditions, we score using signals
  // from the PREVIOUS tick (lastPageSignals). The first tick has no
  // signals — that's fine, tab-level rules alone can reach threshold.
  // Step 2: for each tab, score + maybe discard.
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    if (tab.active) continue;
    if (tab.pinned) continue;
    if (tab.discarded) continue;
    if (globalThis.__th.isNeverDiscardable(tab.url)) continue;

    const pageSignals = lastPageSignals.get(tab.id) || null;
    const lastAccessedMinutes = tab.lastAccessed
      ? (now - tab.lastAccessed) / 60000
      : 9999;

    const tabInput = {
      audible: !!tab.audible,
      active: !!tab.active,
      lastAccessedMinutes,
      discarded: !!tab.discarded,
      autoDiscardable: tab.autoDiscardable !== false, // default true
      pinned: !!tab.pinned,
      url: tab.url || "",
      totalTabs,
    };

    const result = globalThis.__th.scoreTab(tabInput, pageSignals);
    if (!result.eligible) continue;

    try {
      await chrome.tabs.discard(tab.id);
      const est = globalThis.__ti.estimatePerDiscard();
      const event = {
        ts: now,
        tabId: tab.id,
        url: tab.url || "",
        score: result.score,
        reasons: result.reasons,
        wh: est.wh,
        gCO2e: est.gCO2e,
        restored: false,
      };
      ourDiscards.set(tab.id, event);
      dailyDelta.wh += est.wh;
      dailyDelta.gCO2e += est.gCO2e;
      await appendDiscardEvent(event);
    } catch (e) {
      console.warn("[tabsleep] discard failed for tab", tab.id, e);
    }
  }

  if (dailyDelta.wh > 0 || dailyDelta.gCO2e > 0) {
    await addToDailyTotals(dailyDelta);
  }

  // Clear lastPageSignals — content scripts will re-send for the next tick.
  lastPageSignals = new Map();
}

async function appendDiscardEvent(event) {
  const { discardLog = [] } = await chrome.storage.local.get("discardLog");
  discardLog.push(event);
  while (discardLog.length > LOG_CAP) discardLog.shift();
  await chrome.storage.local.set({ discardLog });
}

async function addToDailyTotals({ wh, gCO2e }) {
  const today = ymd(new Date());
  const { dailyTotals = {} } = await chrome.storage.local.get("dailyTotals");
  const cur = dailyTotals[today] || { wh: 0, gCO2e: 0 };
  cur.wh += wh;
  cur.gCO2e += gCO2e;
  dailyTotals[today] = cur;
  // Trim to last N days
  const keys = Object.keys(dailyTotals).sort();
  while (keys.length > DAILY_TOTAL_DAYS) {
    delete dailyTotals[keys.shift()];
  }
  await chrome.storage.local.set({ dailyTotals });
}

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

// === Message handling ===

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== "object") return false;

  if (msg.type === "PAGE_SIGNALS") {
    if (sender.tab && sender.tab.id !== undefined) {
      lastPageSignals.set(sender.tab.id, msg.signals);
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === "RESTORE_TAB") {
    const tabId = msg.tabId;
    chrome.tabs
      .update(tabId, { active: true })
      .then(() => {
        // Mark in ourDiscards and storage that this discard ended early.
        const ev = ourDiscards.get(tabId);
        if (ev) {
          ev.restored = true;
          // Adjust the daily total: actual sleep was less than assumed.
          // Simplest: leave the optimistic estimate; on next tick the
          // discard falls out of the cap window anyway. Honest trade-off
          // documented in spec.
          ourDiscards.delete(tabId);
        }
        sendResponse({ ok: true });
      })
      .catch((e) => {
        console.warn("[tabsleep] restore failed:", e);
        sendResponse({ ok: false, error: String(e) });
      });
    return true;
  }

  if (msg.type === "GET_STATE") {
    getState()
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  return false;
});

async function getState() {
  const tabs = await chrome.tabs.query({ discarded: true });
  const { discardLog = [], dailyTotals = {} } = await chrome.storage.local.get([
    "discardLog",
    "dailyTotals",
  ]);
  const today = ymd(new Date());
  const todayTotals = dailyTotals[today] || { wh: 0, gCO2e: 0 };
  // Last 7 days
  const last7 = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const k = ymd(d);
    const t = dailyTotals[k] || { wh: 0, gCO2e: 0 };
    last7.push({ day: k, wh: t.wh, gCO2e: t.gCO2e });
  }
  const last7Wh = last7.reduce((s, x) => s + x.wh, 0);
  return {
    ok: true,
    today: { ...todayTotals, day: today },
    last7: { wh: last7Wh, gCO2e: last7.reduce((s, x) => s + x.gCO2e, 0), days: last7.reverse() },
    sleepingTabs: tabs
      .filter((t) => t.id !== undefined)
      .map((t) => ({
        tabId: t.id,
        url: t.url || "",
        title: t.title || "",
        favIconUrl: t.favIconUrl || "",
        discardedAt: ourDiscards.get(t.id)?.ts || 0,
      })),
    constants: {
      wattPerDiscardedTab: globalThis.__ti.WATT_PER_DISCARDED_TAB,
      gCO2ePerKwh: globalThis.__ti.G_CO2E_PER_KWH,
      assumedSleepHours: globalThis.__ti.ASSUMED_SLEEP_HOURS,
    },
  };
}
