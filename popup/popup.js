// popup/popup.js
// Reads state from the service worker, renders, sends restore actions.

const $ = (sel) => document.querySelector(sel);

function fmt(n, digits = 2) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (n === 0) return "€0.00";
  // Group thousands with a thin space (e.g. "€1,234.56") for readability.
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtWh(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (n === 0) return "0";
  if (n < 1) return n.toFixed(2);
  if (n < 100) return n.toFixed(1);
  // Group thousands for larger Wh values.
  return Math.round(n).toLocaleString("en-US");
}

function fmtSince(ts) {
  if (!ts) return "sleeping";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just slept";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `${h}h ${rest}m ago`;
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function init() {
  let state;
  try {
    state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  } catch (e) {
    $("#alltime-eur").textContent = "—";
    $("#alltime-wh").textContent = "—";
    $("#relate").textContent = "Service worker not reachable.";
    return;
  }
  if (!state || !state.ok) {
    $("#alltime-eur").textContent = "—";
    $("#alltime-wh").textContent = "—";
    $("#relate").textContent = (state && state.error) || "No state.";
    return;
  }

  // v0.4: Big number is the rolling-30-days all-time total.
  $("#alltime-eur").textContent = fmt(state.allTime.eur, 2);
  $("#alltime-wh").textContent = fmtWh(state.allTime.wh);

  // Relatable comparison in EUR
  const eur = state.allTime.eur;
  if (eur > 0) {
    const coffees = (eur / 3.5).toFixed(2);
    $("#relate").textContent = `≈ ${coffees}× less spent on lattes`;
  } else {
    $("#relate").textContent = "No savings yet.";
  }

  // Last 7
  $("#last7-eur").textContent = fmt(state.last7.eur, 2);

  // Sleeping list
  const list = $("#sleeping-list");
  const empty = $("#sleeping-empty");
  list.innerHTML = "";
  if (!state.sleepingTabs || state.sleepingTabs.length === 0) {
    empty.hidden = false;
  } else {
    empty.hidden = true;
    for (const t of state.sleepingTabs) {
      const li = document.createElement("li");
      li.title = t.url;

      const fav = document.createElement("img");
      fav.className = "favicon";
      fav.src = t.favIconUrl || "";
      fav.alt = "";
      fav.addEventListener("error", () => {
        fav.style.display = "none";
      });
      li.appendChild(fav);

      const info = document.createElement("div");
      info.className = "info";
      const domain = document.createElement("div");
      domain.className = "domain";
      domain.textContent = t.title || domainOf(t.url) || "(leer)";
      const since = document.createElement("div");
      since.className = "since";
      since.textContent = fmtSince(t.discardedAt);
      info.appendChild(domain);
      info.appendChild(since);
      li.appendChild(info);

      li.addEventListener("click", async () => {
        try {
          await chrome.runtime.sendMessage({ type: "RESTORE_TAB", tabId: t.tabId });
          // Re-render shortly to reflect the restore.
          setTimeout(init, 200);
        } catch (e) {
          console.warn("restore failed", e);
        }
      });
      list.appendChild(li);
    }
  }
  $("#sleeping-count").textContent = state.sleepingTabs ? state.sleepingTabs.length : 0;
}

// === Sleep-All button ===

async function onSleepAll() {
  const btn = $("#sleep-all-btn");
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = "Sleeping…";
  try {
    const res = await chrome.runtime.sendMessage({ type: "SLEEP_ALL" });
    if (res && res.ok) {
      btn.textContent = `${res.discarded} sent`;
      setTimeout(() => { btn.textContent = originalText; init(); }, 1200);
    } else {
      btn.textContent = "Error";
      setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 1500);
    }
  } catch (e) {
    console.warn("sleep-all failed", e);
    btn.textContent = "Error";
    setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 1500);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  init();
  const btn = $("#sleep-all-btn");
  if (btn) btn.addEventListener("click", onSleepAll);
});

