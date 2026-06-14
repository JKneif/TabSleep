# 🌙 TabSleep — Tabs that waste energy, put to sleep automatically

> You opened 17 tabs this morning. 12 of them are still running JavaScript, polling servers, and draining your battery — and yours eyes never see them again today.

**TabSleep notices. TabSleep does something about it.**

A tiny Chrome extension that automatically puts wasteful, inactive tabs to sleep using Chrome's own `chrome.tabs.discard()` API. No magic. No ML. No subscription. No tracking. Just sensible rules that decide when a tab is wasting power, and a popup that shows you how much you've saved today.

```
┌────────────────────────────────────┐
│         🌙 TabSleep                │
│                                    │
│       1.2 Wh gespart              │
│       ≈ 0.5 g CO2e                │
│   So viel wie ein 1W-LED für 73 m │
│                                    │
│   Letzte 7 Tage: 8.4 Wh            │
│                                    │
│   SCHLAFENDE TABS  3               │
│   ▣ hackernews.com     seit 12 min │
│   ▣ docs.example.com   seit 24 min │
│   ▣ twitter.com        seit 31 min │
└────────────────────────────────────┘
```

---

## ⚡ What it actually does

Every 60 seconds, TabSleep scores every open tab against 8 simple rules:

- **Audible** for >5 minutes while not active → +30
- **Inactive** (no clicks) for >10 minutes → +20
- **Long-running JavaScript tasks** detected by the browser → +25
- **WebSocket reconnect storms** (sites stuck in retry loops) → +20
- **Audio playing off-screen** (videos you can't see) → +15
- **Cumulative layout shift** (CSS thrash) → +10
- **Discardable** (browser allows it, you didn't pin it) → +5 baseline
- **Lots of tabs open** (>20)? Score is multiplied by 1.5× — more aggressive.

Score ≥ 60 → `chrome.tabs.discard(tabId)`. Chrome freezes the tab. You see a dimmed favicon. When you click it, Chrome unfreezes and reloads. **Your data is never lost.** Tabs are restored with one click in the popup.

---

## 🛡️ What it doesn't touch

- **Pinned tabs** — ever.
- **The active tab** — ever.
- **Tabs you right-clicked → "Don't discard"** — ever.
- **`chrome://`, `about:`, the Chrome Web Store, dev tools, PDF viewer** — never.
- **Tabs with audio playing visibly on your screen** — for 5 minutes. After that, fair game.

It also runs **100% locally**. No server, no telemetry, no analytics, no "anonymous usage data". The popup footer says so explicitly: *"Alle Daten lokal · chrome.storage.local"*.

---

## 📦 Install in 30 seconds

1. `chrome://extensions/` → toggle **Developer mode** (top right).
2. **Load unpacked** → select this `tabsleep/` folder.
3. Pin the icon. Open 10+ tabs. Wait 1 minute. Watch the popup.

That's it. No accounts, no flags, no Chrome version restrictions (works on Chrome 120+).

---

## 🛠️ How it works (for the curious)

```
┌──────────────────┐  sendMessage   ┌──────────────────┐
│  Content script  │ ─────────────▶ │  Service worker  │
│  (per tab)       │                │  (one per         │
│                  │                │   extension)      │
│  - long tasks    │  60s alarm     │                  │
│  - WS reconnects │ ─────────────▶ │  - score tabs     │
│  - audio/video   │                │  - discard low    │
│  - layout shift  │                │    performers     │
└──────────────────┘                │  - log to storage │
                                     └──────────────────┘
```

Three clean modules, **zero dependencies**, **zero network calls**:

- `content/content.js` — in-page measurement. Posts `{score, signals}` to the service worker.
- `background/service-worker.js` — owns the discard decision. Wakes on a 60s `chrome.alarms` tick. Logs to `chrome.storage.local`.
- `lib/heuristic.js` + `lib/impact.js` — pure scoring + impact math. No I/O. Centralized so the assumption constants live in one place.
- `popup/*` — reads state, renders, sends restore actions.

---

## 📊 The math (and the assumptions)

We estimate `0.05 W` saved per discarded tab while it's sleeping. Real CPU-heavy tabs draw 0.1-0.5 W; idle tabs 0.02-0.05 W. We use the **conservative** end of the range so you don't feel cheated.

```js
// lib/impact.js
const WATT_PER_DISCARDED_TAB = 0.05; // conservative
const G_CO2E_PER_KWH = 380;           // DE 2024, DESTATIS
const ASSUMED_SLEEP_HOURS = 8;        // typical workday
```

At the time of discard we don't know how long the tab will stay asleep, so we optimistically count 8h × 0.05 W = 0.4 Wh per discarded tab. The number you see in the popup is the running daily total. Honest, conservative, and easy to tune in one file.

---

## 🌍 Why this matters (the actual numbers)

- A modern laptop draws ~15-25 W at idle. A handful of open but unused tabs can easily cost 0.5-2 W of that.
- For a knowledge worker with 20+ tabs and an 8h workday, that's ~1-2 Wh/day in CPU/JS execution alone. Add display brightness, networking, and fan activity, and you're easily into **double-digit Wh/day** of avoidable drain.
- Over a year for one person, that's 5-10 kWh. Not huge in absolute terms, but multiplied by 10,000 users, you're looking at 50-100 MWh/year — roughly the annual consumption of 20 European households.

We don't pretend this is a climate panacea. **It's hygiene, not heroism.** But hygiene is what compounds.

---

## 🧪 Development

```bash
git clone https://github.com/JKneif/tabsleep.git
cd tabsleep

# Regenerate icons
npm install --no-save sharp
node scripts/build-icons.js

# Load in Chrome
# chrome://extensions/ → Developer mode → Load unpacked → this folder
```

### Verifying

```bash
node --check popup/popup.js content/content.js lib/heuristic.js lib/impact.js background/service-worker.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json'))"
```

Both should exit 0. If they don't, you broke something.

---

## 🚧 What this is NOT (v0.1 honesty)

- ❌ **No per-user tunable thresholds** — they live in `lib/heuristic.js`. Edit and reload. Pull requests welcome.
- ❌ **No land/grid selector** for CO2 — hardcoded to DE 2024 (380 g/kWh). If you want US/EU/world, that's a 10-line PR.
- ❌ **No ML, no per-site learning** — the rules are the same for everyone. Good news: no training data to leak.
- ❌ **No Firefox / Edge support** — built for Chrome MV3. The discard API differs in Firefox (`browser.tabs.discard` exists, semantics differ).
- ❌ **No Chrome Web Store submission** — unpacked only. We don't trust the review process for tools that affect all your tabs.

---

## 📜 License

MIT.

---

## ⭐ Why you should star this

- **It does one thing, in 4 files of actual logic.** Read the whole codebase in 10 minutes.
- **It uses Chrome's own APIs, not a custom suspend system.** The Great Suspender was killed because they injected a custom script that ran in every page. TabSleep uses `chrome.tabs.discard()`. There is literally no extension-injected code in your tabs.
- **It respects your data.** All numbers are stored in your browser. Open DevTools → Application → Local Storage and inspect `chrome-extension://...`. That's it.
- **It's honest about its numbers.** The impact model is conservative and centralized in one file. If you disagree with the assumptions, change them and see the effect.

⭐ **If this saved you from reloading a frozen Gmail tab one less time today, hit the star.**

---

<sub>Built with 🫶 on top of Chrome's own `chrome.tabs.discard()`. No external services. No tracking. No nonsense.</sub>
