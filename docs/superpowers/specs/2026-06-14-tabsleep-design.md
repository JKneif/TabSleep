# TabSleep — Chrome Extension Design

**Date:** 2026-06-14
**Status:** Approved (auto-approval per user request: "Passt")
**Target:** MV3 Chrome Extension, local use, Chrome 138+

## Purpose

A Chrome extension that automatically puts wasteful, inactive tabs to sleep using Chrome's native `chrome.tabs.discard()` API. Detection combines browser-level signals (idle, audible, last-accessed) with in-page signals (long tasks, WebSocket reconnects, audio without video, layout thrash) to score each tab. Discarded tabs are restored with a single click and never lose data — Chrome handles that. The popup shows today's savings in Wh + g CO2e and a list of currently-sleeping tabs.

Runs 100% on-device. No telemetry. No servers. No account.

## Constraints & Assumptions

- **Distribution:** Unpacked extension via `chrome://extensions/` developer mode.
- **Engine:** Chrome built-in `chrome.tabs.discard()`. Available since Chrome 54.
- **Interval:** 60s alarm-based service-worker tick.
- **Whitelist:** First iteration has no UI; users right-click a tab → "Don't discard" (Chrome built-in) to opt out. We respect `tab.autoDiscardable === false`.
- **Impact model (v0.2 — money):** `0.5 W` saved per discarded tab (upper end of realistic range, aggressive per user preference). Money conversion: `0.40 EUR/kWh` (BDEW German household average 2024, all-in). Per-discard: `~1.6 ct` (8h assumption). Hardcoded with comment for v0.2.
- **Mode (v0.2 — aggressive):** `DISCARD_THRESHOLD=20` (was 60), `INACTIVE_MINUTES=2` (was 10), `AUDIBLE_MINUTES=0` (was 5), `LONG_TASKS_THRESHOLD=2` (was 5), `WS_RECONNECTS_THRESHOLD=1` (was 3), `LAYOUT_SHIFTS_THRESHOLD=4` (was 10). Tabs that haven't been touched in 2 minutes and are not active become candidates.
- **Sleep-All button (v0.2):** Popup header has a "Alles schlafen" button that immediately discards every eligible tab (skips pinned, active, never-discard URLs). Bypasses the score threshold — manual override.
- **No ML**, no MutationObserver in content script — Performance-Observer is enough.
- **No notifications** — only the popup shows what happened. Less noise, more trust.
- **Storage:** `chrome.storage.local`. Keeps last 200 discard events + daily totals. No remote sync.

## Architecture

```
manifest.json                MV3 config
background/service-worker.js Orchestrates: tab polling, scoring, discard, logging
content/content.js           In-page measurement (long tasks, WS reconnects, audio, layout)
lib/heuristic.js             Shared scoring rules (5-8) — no DOM access
lib/impact.js                Shared impact estimation (kWh, gCO2e)
popup/                       UI: today's savings + sleeping-tab list
icons/                       SVG + 16/48/128 PNG
```

### Module Boundaries

- `content/content.js` — in-page measurement only. Posts a `{score, signals}` message to the service worker periodically. No decision-making.
- `background/service-worker.js` — owns the discard decision. Reads tab-level signals via `chrome.tabs.*` and page-level signals from the content-script message. Writes discard log to `chrome.storage.local`. Wakes on a 60s `chrome.alarms` tick.
- `lib/heuristic.js` — pure scoring function. Same code path for tab-level (with `pageSignals` undefined) and page-level inputs. No I/O.
- `lib/impact.js` — pure impact calculation. No I/O.
- `popup/*` — reads `chrome.storage.local`, renders, sends `{type: "RESTORE_TAB", tabId}` messages back to service worker.

## Heuristics (8 rules, summed to a score)

### Tab-level (service worker)

| # | Signal | Source | Points |
|---|---|---|---|
| 1 | Audible + not active + audible > 5 min | `chrome.tabs.query({audible: true})` + heuristic timer | +30 |
| 2 | Not active + `lastAccessed` > 10 min | `chrome.tabs.Tab.lastAccessed` | +20 |
| 3 | Not yet discarded + `autoDiscardable !== false` | `chrome.tabs.Tab.discarded`, `autoDiscardable` | +5 baseline |
| 4 | Total open tabs > 20 | `chrome.tabs.query({})` length | ×1.5 score multiplier |

### Page-level (content script, posted to SW)

| # | Signal | Source | Points |
|---|---|---|---|
| 5 | Long tasks > 5 in last 60s | `PerformanceObserver({entryTypes: ['longtask']})` | +25 |
| 6 | WebSocket reconnects > 3 in last 60s | Override `WebSocket.prototype.addEventListener('close')` counter | +20 |
| 7 | AudioContext running, no visible `<video>` in viewport | `AudioContext.state` + `document.querySelector('video')` intersect check | +15 |
| 8 | Cumulative layout shift > 10 in last 60s (no recent input) | `PerformanceObserver({entryTypes: ['layout-shift']})` | +10 |

### Discard rule

`score >= 60` AND `!pinned` AND `!active` AND `autoDiscardable !== false` AND `tab.url` is not in the never-discard set (`chrome://`, `about:`, `chrome-extension://`, `edge://`, `devtools://`) → `chrome.tabs.discard(tabId)`.

## Data Flow

### Service-worker tick (every 60s)

1. Alarm wakes SW.
2. `chrome.tabs.query({})` → all tabs.
3. For each candidate tab, read tab-level signals (1-4), apply heuristic.
4. If score >= 60 AND criteria met → `chrome.tabs.discard(tabId)`.
5. Send `{type: "REQUEST_PAGE_SIGNALS"}` to all other tabs to get page-level signals (5-8) and add to the next tick's score.
6. On discard: append to `discardLog` in `chrome.storage.local`, update `dailyTotals`.

### Page-level measurement (content script)

1. On `document_idle`: set up `PerformanceObserver`s for `longtask` and `layout-shift`.
2. Patch `WebSocket` prototype to count `close` events.
3. Check `AudioContext` state + visible `<video>` on load and every 30s.
4. Send `{type: "PAGE_SIGNALS", signals: {longTasks, wsReconnects, audioActive, layoutShifts}}` to SW every 30s.

### Popup open

1. Read `discardLog` and `dailyTotals` from `chrome.storage.local`.
2. Compute today's total + last-7-days totals.
3. Render big number + list of currently-discarded tabs.
4. On click on a sleeping tab → `{type: "RESTORE_TAB", tabId}` to SW → SW calls `chrome.tabs.update(tabId, {active: true})` (Chrome auto-restores on access).

## Impact Model

`lib/impact.js`:

```js
// 0.05 W saved per discarded tab while it's sleeping.
// Conservative: real CPU-heavy tabs draw 0.1-0.5 W, idle tabs 0.02-0.05 W.
// We use the conservative end of the range so users feel they're being
// honest with themselves.
const WATT_PER_DISCARDED_TAB = 0.05;

// Germany 2024 grid average (DESTATIS, conservative):
// 380 g CO2e per kWh. Update yearly in a single edit.
const G_CO2E_PER_KWH = 380;

function kwhSavedMs(watts, ms) {
  return (watts * ms) / 1000 / 3600 / 1000; // W * h / 1000 = kWh
}

function gCO2e(kwh) {
  return kwh * G_CO2E_PER_KWH * 1000; // kWh * g/kWh = g
}
```

At the time of discard we don't know how long the tab will stay discarded. We optimistically count **0.05 W × 8 h** (typical workday) per discard as a baseline. If a discard is restored before 8h, we retroactively adjust the daily total on the next tick (capped at 0).

## Persistence

`chrome.storage.local`:

- `discardLog`: array of last 200 events `{ts, tabId, url, score, wattHours, gCO2e}`. Capped, FIFO.
- `dailyTotals`: object keyed by `YYYY-MM-DD` → `{wh, gCO2e}`. Trimmed to last 30 days on each write.
- `lastTickAt`: timestamp for tick diagnostics.

## UI

Popup: 280×340 px. Sections:

- **Header:** "TabSleep" + small ℹ-icon
- **Big number:** "Heute 1.2 Wh gespart" (green) + "≈ 0.5 g CO2e"
- **Relatable:** "So viel wie ein 1W-LED für 73 Minuten"
- **Subtitle:** "Letzte 7 Tage: 8.4 Wh"
- **Sleeping tabs list:** favicon + domain + "schläft seit HH:MM" + click-to-restore
- **Footer:** "Alle Daten lokal · chrome.storage.local"

## Verification

1. `node --check` on all JS files → exit 0.
2. `JSON.parse` on `manifest.json` → ok.
3. Manual smoke test (documented in README):
   - Open 5+ tabs, some audible, some idle.
   - Wait 60-120s.
   - Verify discarded tabs get a "frozen" favicon.
   - Click discarded tab in popup → restored.
   - Verify big-number updates.

## Out of Scope (v0.1)

- User-configurable thresholds
- Land selector for CO2 grid factor
- Whitelist UI (relies on Chrome's built-in "Don't discard")
- Per-tab energy breakdown
- Sparkline charts (just numbers + list for v0.1)
- Firefox / Edge cross-browser
- Chrome Web Store submission
