// popup.js — UI de l'extension amzinvite (mode local + feed public)

const $ = (id) => document.getElementById(id);
let nextCheckTimer = null;
const STALE_PROGRESS_MS = 45_000;
const CHECK_BUTTON_TIMEOUT_MS = 5 * 60 * 1000;

const HIDDEN_BY_DEFAULT = new Set(["already_requested", "not_invitation"]);

const STATE_LABELS = {
  available: { txt: "🎟️ Dispo, à demander", cls: "available" },
  already_requested: { txt: "✓ Déjà demandée", cls: "already_requested" },
  accepted: { txt: "🎉 SÉLECTIONNÉ — Acheter (72h)", cls: "accepted" },
  not_invitation: { txt: "Plus en invitation", cls: "not_invitation" },
  unknown: { txt: "Pas encore vérifié", cls: "unknown" },
  stub_no_data: { txt: "⏳ À revérifier", cls: "unknown" },
};

async function load() {
  const manifest = chrome.runtime.getManifest?.();
  const cfg = await chrome.storage.local.get([
    "intervalMin", "autoRequest", "telemetryEnabled", "scrapeEnabled",
    "lastRun", "showAll", "checkProgress",
  ]);
  $("version").textContent = `Version ${manifest?.version || "?"}`;
  setVal("intervalMin", cfg.intervalMin || 30);
  setChecked("autoRequest", cfg.autoRequest);
  setChecked("telemetryEnabled", cfg.telemetryEnabled);
  setChecked("scrapeEnabled", cfg.scrapeEnabled);
  setChecked("showAll", cfg.showAll);

  await refreshList(cfg.lastRun);
  await refreshNextCheck();

  if (cfg.checkProgress) {
    if (isProgressStale(cfg.checkProgress)) {
      await chrome.storage.local.remove("checkProgress");
      $("err").textContent = "Check précédent interrompu. Réessaie.";
    } else {
      renderCheckProgress(cfg.checkProgress);
      $("check").disabled = true;
    }
  }
  startProgressListener();
}

function setVal(id, val) { const el = $(id); if (el) el.value = val; }
function setChecked(id, val) { const el = $(id); if (el) el.checked = !!val; }

function isProgressStale(p) { return !p?.startedAt || Date.now() - p.startedAt > STALE_PROGRESS_MS; }

let progressListenerStarted = false;
function startProgressListener() {
  if (progressListenerStarted) return;
  progressListenerStarted = true;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.checkProgress) {
      const next = changes.checkProgress.newValue;
      if (next) { renderCheckProgress(next); $("check").disabled = true; }
      else { $("check").disabled = false; }
    }
    if (changes.lastRun || changes.knownStates || changes.publicFeed || changes.customUrls) {
      refreshList(changes.lastRun?.newValue);
    }
  });
}

function renderCheckProgress(p) {
  if (!p) return;
  if (p.phase === "watchlist") $("sub").textContent = "Check en cours…";
  else if (p.phase === "checking") {
    const name = p.currentName ? ` · ${truncate(p.currentName, 40)}` : "";
    $("sub").textContent = `Check en cours… ${p.current}/${p.total}${name}`;
  }
}

function truncate(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

async function refreshList(lastRun) {
  const res = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: "get-watchlist" }, resolve);
  });
  if (!res?.ok) {
    $("err").textContent = `Erreur : ${res?.error || "inconnue"}`;
    renderEmpty();
    return;
  }
  renderList(res.items, lastRun);
  renderHeader(res.items, lastRun);
}

function renderHeader(items, lastRun) {
  const counts = { available: 0, already_requested: 0, accepted: 0 };
  for (const it of items) {
    const s = it.known_state || "unknown";
    if (s in counts) counts[s]++;
  }
  $("stat-available").textContent = counts.available + counts.accepted;
  $("stat-requested").textContent = counts.already_requested;
  $("stat-total").textContent = items.length;
  if (lastRun) {
    const ago = relativeTime(lastRun.ts);
    const errs = lastRun.errors ? ` · ⚠ ${lastRun.errors} erreur(s)` : "";
    $("sub").textContent = `Dernier check ${ago} · ${lastRun.checked || 0} OK${errs}`;
  } else {
    $("sub").textContent = `${items.length} produit(s) suivis`;
  }
}

async function refreshNextCheck() {
  const res = await new Promise((r) => chrome.runtime.sendMessage({ type: "get-schedule" }, r));
  if (!res?.ok || !res.schedule?.scheduledTime) {
    $("next-check").textContent = "Prochain check auto : non planifié";
    stopNextCheckTimer();
    return;
  }
  startNextCheckTimer(res.schedule.scheduledTime);
}

function startNextCheckTimer(scheduledTime) {
  stopNextCheckTimer();
  const render = () => {
    const remainingMs = Math.max(0, scheduledTime - Date.now());
    if (remainingMs === 0) { stopNextCheckTimer(); refreshNextCheck().catch(() => {}); return; }
    $("next-check").textContent = `Prochain check auto dans ${formatCountdown(remainingMs)}`;
  };
  render();
  nextCheckTimer = setInterval(render, 1000);
}

function stopNextCheckTimer() {
  if (nextCheckTimer) { clearInterval(nextCheckTimer); nextCheckTimer = null; }
}

function formatCountdown(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function renderEmpty() {
  $("list").innerHTML = "";
  $("empty").style.display = "block";
  ["stat-available", "stat-requested", "stat-total"].forEach((id) => { $(id).textContent = "—"; });
}

function renderList(items, lastRun) {
  const list = $("list");
  list.innerHTML = "";
  if (!items.length) { $("empty").style.display = "block"; return; }

  const order = { accepted: 0, available: 1, already_requested: 2 };
  const sorted = [...items].sort((a, b) => {
    const sa = a.known_state || "z";
    const sb = b.known_state || "z";
    return (order[sa] ?? 99) - (order[sb] ?? 99);
  });

  const showAll = $("showAll").checked;
  let hiddenCount = 0;
  let rendered = 0;

  for (const it of sorted) {
    const state = it.known_state || "unknown";
    if (!showAll && HIDDEN_BY_DEFAULT.has(state)) { hiddenCount++; continue; }
    const label = STATE_LABELS[state] || { txt: state, cls: "unknown" };
    const li = document.createElement("li");
    li.className = "product";
    const pillTag = state === "accepted"
      ? `<a class="pill ${label.cls}" href="${escapeAttr(it.url)}" target="_blank" rel="noopener">${escapeHTML(label.txt)}</a>`
      : `<span class="pill ${label.cls}">${escapeHTML(label.txt)}</span>`;
    const removeBtn = it.custom
      ? `<button class="remove" data-url="${escapeAttr(it.url)}" title="Retirer">×</button>`
      : "";
    li.innerHTML = `
      <div class="body">
        <div class="name">${escapeHTML(it.name || asinFromUrl(it.url) || it.url)}</div>
        <div class="link"><a href="${escapeAttr(it.url)}" target="_blank">${escapeHTML(shortPath(it.url))}</a></div>
      </div>
      ${pillTag}
      ${removeBtn}
    `;
    list.appendChild(li);
    rendered++;
  }

  list.querySelectorAll(".remove").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const url = e.target.dataset.url;
      await new Promise((r) => chrome.runtime.sendMessage({ type: "remove-custom-url", url }, r));
      await refreshList();
    });
  });

  if (rendered === 0 && hiddenCount > 0) {
    $("empty").style.display = "block";
    $("empty").innerHTML = `<div class="big">🙈</div>${hiddenCount} produit(s) masqué(s).<br/><span style="font-size:11px">Coche "Tout afficher" pour les voir.</span>`;
  } else {
    $("empty").style.display = "none";
  }
  $("list-title").textContent = hiddenCount && !showAll
    ? `Suivi (${rendered} affichés · ${hiddenCount} masqués)`
    : `Suivi (${rendered})`;
}

function relativeTime(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `il y a ${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  return `il y a ${Math.round(m / 60)} h`;
}

function asinFromUrl(url) {
  try {
    const m = new URL(url).pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    return m ? m[1] : null;
  } catch { return null; }
}

function shortPath(url) { const a = asinFromUrl(url); return a ? `/dp/${a}` : url; }
function escapeHTML(s) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function escapeAttr(s) { return escapeHTML(s).replace(/"/g, "&quot;"); }

// ── Listeners ───────────────────────────────────────────────────────────

$("toggle-settings").addEventListener("click", () => $("settings").classList.toggle("open"));

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    intervalMin: Math.max(5, parseInt($("intervalMin").value || "30", 10)),
    autoRequest: $("autoRequest").checked,
    telemetryEnabled: $("telemetryEnabled").checked,
    scrapeEnabled: $("scrapeEnabled").checked,
  });
  await new Promise((r) => chrome.runtime.sendMessage({ type: "reschedule-alarm" }, r));
  $("sub").textContent = "Réglages enregistrés.";
  await refreshNextCheck();
});

$("autoRequest").addEventListener("change", async () => {
  await chrome.storage.local.set({ autoRequest: $("autoRequest").checked });
});
$("telemetryEnabled").addEventListener("change", async () => {
  await chrome.storage.local.set({ telemetryEnabled: $("telemetryEnabled").checked });
});
$("scrapeEnabled").addEventListener("change", async () => {
  await chrome.storage.local.set({ scrapeEnabled: $("scrapeEnabled").checked });
});

$("showAll").addEventListener("change", async () => {
  await chrome.storage.local.set({ showAll: $("showAll").checked });
  await refreshList();
});

$("addBtn").addEventListener("click", async () => {
  const url = $("addUrl").value.trim();
  if (!url || !asinFromUrl(url)) {
    $("err").textContent = "URL invalide : doit contenir /dp/ASIN ou /gp/product/ASIN";
    return;
  }
  $("err").textContent = "";
  await new Promise((r) => chrome.runtime.sendMessage({ type: "add-custom-url", url }, r));
  $("addUrl").value = "";
  await refreshList();
});

$("reset").addEventListener("click", async () => {
  if (!confirm("Reset complet : suppression de ton instanceId, de la watchlist custom et de tous les états. Continuer ?")) return;
  await new Promise((r) => chrome.runtime.sendMessage({ type: "reset-instance" }, r));
  window.close();
});

$("check").addEventListener("click", async () => {
  $("err").textContent = "";
  $("sub").textContent = "Check en cours…";
  $("check").disabled = true;
  let settled = false;
  const finalize = async () => {
    if (settled) return;
    settled = true;
    chrome.storage.onChanged.removeListener(storageListener);
    clearTimeout(timeoutHandle);
    await refreshList();
    $("check").disabled = false;
  };
  const cfgBefore = await chrome.storage.local.get("lastRun");
  const prev = cfgBefore.lastRun?.ts || 0;
  const storageListener = (changes, area) => {
    if (area === "local" && changes.lastRun?.newValue?.ts > prev) finalize();
  };
  chrome.storage.onChanged.addListener(storageListener);
  const timeoutHandle = setTimeout(finalize, CHECK_BUTTON_TIMEOUT_MS);
  chrome.runtime.sendMessage({ type: "check-now" }, () => { void chrome.runtime.lastError; finalize(); });
});

window.addEventListener("beforeunload", stopNextCheckTimer);
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
else load();
