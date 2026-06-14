// popup/popup.js
// Reads state from the service worker, renders, sends restore actions.

const $ = (sel) => document.querySelector(sel);

function fmt(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (n === 0) return "0";
  if (n < 0.01) return n.toExponential(1);
  return n.toFixed(digits);
}

function fmtMinutes(min) {
  if (!min || min < 1) return "Weniger als 1 Minute";
  if (min < 60) return `≈ ein 1W-LED für ${min} Minuten`;
  const h = Math.round(min / 60);
  return `≈ ein 1W-LED für ${h} Stunden`;
}

function fmtSince(ts) {
  if (!ts) return "schläft";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "gerade eingeschlafen";
  if (m < 60) return `seit ${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return `seit ${h}h ${rest}m`;
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
    $("#today-wh").textContent = "—";
    $("#today-co2").textContent = "—";
    $("#relate").textContent = "Service worker nicht erreichbar.";
    return;
  }
  if (!state || !state.ok) {
    $("#today-wh").textContent = "—";
    $("#today-co2").textContent = "—";
    $("#relate").textContent = (state && state.error) || "Kein State.";
    return;
  }

  // Today
  $("#today-wh").textContent = fmt(state.today.wh, 2);
  $("#today-co2").textContent = fmt(state.today.gCO2e, 2);

  // Relatable (computed locally from wh to avoid coupling popup to impact lib)
  const wh = state.today.wh;
  // 1W LED for X minutes = X/60 Wh
  const minutes = wh > 0 ? Math.max(1, Math.round(wh * 60)) : 0;
  $("#relate").textContent = wh > 0
    ? `So viel wie ein 1W-LED für ${minutes} Minuten`
    : "Noch keine Ersparnis heute.";

  // Last 7
  $("#last7-wh").textContent = `${fmt(state.last7.wh, 1)} Wh`;

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

document.addEventListener("DOMContentLoaded", init);
