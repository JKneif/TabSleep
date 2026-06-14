# TabSleep — Chrome Extension Design

**Date:** 2026-06-14
**Status:** v0.4 in production
**Target:** MV3 Chrome Extension, local use, Chrome 120+

## Purpose

A Chrome extension that automatically puts wasteful, inactive tabs to sleep using Chrome's native `chrome.tabs.discard()` API. Detection combines browser-level signals (idle, audible, last-accessed) with in-page signals (long tasks, WebSocket reconnects, audio without video, layout thrash) to score each tab. Discarded tabs are restored with a single click and never lose data — Chrome handles that. The popup shows the rolling-30-day savings in EUR + Wh and a list of currently-sleeping tabs.

Runs 100% on-device. No telemetry. No servers. No account.

## Constraints & Assumptions

- **Distribution:** Unpacked extension via `chrome://extensions/` developer mode.
- **Engine:** Chrome built-in `chrome.tabs.discard()`. Available since Chrome 54.
- **Interval:** 60s alarm-based service-worker tick.
- **Whitelist:** First iteration has no UI; users right-click a tab → "Don't discard" (Chrome built-in) to opt out. We respect `tab.autoDiscardable === false`.
- **Impact model (v0.4):** `0.5 W` saved per discarded tab (upper end of realistic range, aggressive per user preference). Money conversion: `0.40 EUR/kWh` (BDEW German household average 2024, all-in). Per-discard: `~€0.08` (4h assumption).
- **Mode (v0.4 — relaxed defaults):** `DISCARD_THRESHOLD=40`, `INACTIVE_MINUTES=10`, `AUDIBLE_MINUTES=5`, `LONG_TASKS_THRESHOLD=4`, `WS_RECONNECTS_THRESHOLD=2`, `LAYOUT_SHIFTS_THRESHOLD=6`. Tabs that haven't been touched in 10 minutes and are not active become candidates.
- **Sleep-All button:** Popup header has a "Sleep all" button that immediately discards every eligible tab (skips pinned, active, never-discard URLs). Bypasses the score threshold.
- **No ML**, no MutationObserver in content script — Performance-Observer is enough.
- **No notifications** — only the popup shows what happened.
- **Storage:** `chrome.storage.local`. Keeps last 200 discard events + daily totals (trimmed to 30 days). No remote sync.

## Architecture

```
manifest.json                MV3 config
background/service-worker.js Orchestrates: tab polling, scoring, discard, logging
content/content.js           In-page measurement (long tasks, WS reconnects, audio, layout)
lib/heuristic.js             Shared scoring rules (8) — no DOM access
lib/impact.js                Shared impact estimation (EUR, Wh)
popup/                       UI: rolling-30-day savings + sleeping-tab list
icons/                       SVG + 16/48/128 PNG
```

### Module Boundaries

- `content/content.js` — in-page measurement only. Posts a `{signals}` message to the service worker every 30s. No decision-making.
- `background/service-worker.js` — owns the discard decision. Reads tab-level signals via `chrome.tabs.*` and page-level signals from content-script messages. Writes discard log to `chrome.storage.local`. Wakes on a 60s `chrome.alarms` tick.
- `lib/heuristic.js` — pure scoring function. Same code path for tab-level and page-level inputs. No I/O.
- `lib/impact.js` — pure impact calculation. No I/O.
- `popup/*` — reads `chrome.storage.local`, renders, sends `{type: "RESTORE_TAB", tabId}` and `{type: "SLEEP_ALL"}` messages back to service worker.

## Heuristics (8 rules, summed to a score)

### Tab-level (service worker)

| # | Signal | Source | Points |
|---|---|---|---|
| 1 | Audible + not active + audible > 5 min | `chrome.tabs.query({audible: true})` + timer | +30 |
| 2 | Not active + `lastAccessed` > 10 min | `chrome.tabs.Tab.lastAccessed` | +20 |
| 3 | Not yet discarded + `autoDiscardable !== false` | `chrome.tabs.Tab.discarded`, `autoDiscardable` | +5 baseline |
| 4 | Total open tabs > 20 | `chrome.tabs.query({})` length | ×1.5 score multiplier |

### Page-level (content script, posted to SW)

| # | Signal | Source | Points |
|---|---|---|---|
| 5 | Long tasks > 4 in last 60s | `PerformanceObserver({entryTypes: ['longtask']})` | +25 |
| 6 | WebSocket reconnects > 2 in last 60s | Override `WebSocket.prototype.addEventListener('close')` counter | +20 |
| 7 | AudioContext running, no visible `<video>` in viewport | `AudioContext.state` + `document.querySelector('video')` intersect check | +15 |
| 8 | Cumulative layout shift > 6 in last 60s (no recent input) | `PerformanceObserver({entryTypes: ['layout-shift']})` | +10 |

### Discard rule

`score >= 40` AND `!pinned` AND `!active` AND `autoDiscardable !== false` AND `tab.url` is not in the never-discard set (`chrome://`, `about:`, `chrome-extension://`, `edge://`, `devtools://`) → `chrome.tabs.discard(tabId)`.

## Data Flow

### Service-worker tick (every 60s)

1. Alarm wakes SW.
2. `chrome.tabs.query({})` → all tabs.
3. For each candidate tab, read tab-level signals (1-4), apply heuristic using last-known page signals.
4. If score >= 40 AND criteria met → `chrome.tabs.discard(tabId)`.
5. On discard: append to `discardLog` in `chrome.storage.local`, update `dailyTotals` (keyed by `YYYY-MM-DD`).
6. Clear `lastPageSignals` map — content scripts will re-send for the next tick.

### Page-level measurement (content script)

1. On `document_idle`: set up `PerformanceObserver`s for `longtask` and `layout-shift`.
2. Patch `WebSocket` prototype to count `close` events.
3. Check media element visibility for offscreen audio.
4. Send `{type: "PAGE_SIGNALS", signals: {longTasks, wsReconnects, audioNoVideo, layoutShifts}}` to SW every 30s.

### Sleep-All (manual override)

1. User clicks "Sleep all" in popup.
2. Popup sends `{type: "SLEEP_ALL"}` to SW.
3. SW iterates all tabs, discards each eligible one (skips pinned, active, never-discard URLs).
4. Bypasses the score threshold — this is the user's manual "send everything to sleep" command.
5. Each discard still runs the full accounting path: per-discard Wh + EUR, daily totals, log entry with `score: 999, reasons: ["manual_sleep_all"]`.

### Popup open

1. Read `discardLog` and `dailyTotals` from `chrome.storage.local`.
2. Compute rolling-30-day total (sum of all `dailyTotals`).
3. Compute last-7-days total.
4. Render big number (30-day total) + list of currently-discarded tabs.
5. On click on a sleeping tab → `{type: "RESTORE_TAB", tabId}` to SW → SW calls `chrome.tabs.update(tabId, {active: true})` (Chrome auto-restores on access).
6. On click "Sleep all" → `{type: "SLEEP_ALL"}` → SW processes.

## Impact Model

`lib/impact.js`:

```js
// v0.4 defaults
const WATT_PER_DISCARDED_TAB = 0.5;  // upper end of realistic range
const EUR_PER_KWH = 0.40;            // DE 2024, BDEW average
const ASSUMED_SLEEP_HOURS = 4;       // typical mid-day discard
```

At the time of discard we don't know how long the tab will stay discarded. We optimistically count **0.5 W × 4h** = 2 Wh = **€0.08** per discard as a baseline. If a discard is restored before 4h, we retroactively adjust the daily total on the next tick (capped at 0).

## Persistence

`chrome.storage.local`:

- `discardLog`: array of last 200 events `{ts, tabId, url, score, reasons, wh, eur, restored}`. Capped, FIFO.
- `dailyTotals`: object keyed by `YYYY-MM-DD` → `{wh, eur}`. Trimmed to last 30 days on each write.

## UI

Popup: 320×~340 px. Sections:

- **Header:** "🌙 TabSleep" + "Sleep all" button
- **Big number:** "€XX.XX saved (30 days)" + Wh as subline + relatable comparison (lattes)
- **Subtitle:** "Last 7 days: €X.XX"
- **Sleeping tabs list:** favicon + domain + "X min ago" + click-to-restore
- **Footer:** "All data local · chrome.storage.local"

## Verification

1. `node --check` on all JS files → exit 0.
2. `JSON.parse` on `manifest.json` → ok.
3. Manual smoke test (documented in README):
   - Open 5+ tabs, some audible, some idle.
   - Wait 60-120s.
   - Verify discarded tabs get a "frozen" favicon.
   - Click "Sleep all" — all eligible tabs discarded.
   - Click discarded tab in popup → restored.
   - Verify big-number updates over time.

## Out of Scope (v0.4)

- User-configurable thresholds
- Land selector for EUR/kWh tariff
- Whitelist UI (relies on Chrome's built-in "Don't discard")
- Per-tab energy breakdown
- Sparkline charts (just numbers + list)
- Firefox / Edge cross-browser
- Chrome Web Store submission
