const $ = (id) => document.getElementById(id);

let nextCheckTimer = null;
let activeFilter = "all";
const STALE_PROGRESS_MS = 45_000;
const CHECK_BUTTON_TIMEOUT_MS = 5 * 60 * 1000;
const HIDDEN_BY_DEFAULT = new Set(["already_requested", "not_invitation"]);

const STATE_LABELS = {
  available: { txt: "Dispo à demander", cls: "available" },
  already_requested: { txt: "Déjà demandée", cls: "already_requested" },
  accepted: { txt: "Sélectionné", cls: "accepted" },
  not_invitation: { txt: "Hors invitation", cls: "not_invitation" },
  unknown: { txt: "À vérifier", cls: "unknown" },
  stub_no_data: { txt: "À revérifier", cls: "unknown" },
};

async function sendMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function setVal(id, val) {
  const el = $(id);
  if (el) el.value = val;
}

function setChecked(id, val) {
  const el = $(id);
  if (el) el.checked = !!val;
}

function setError(message = "") {
  const el = $("err");
  if (!message) {
    el.textContent = "";
    el.classList.remove("visible");
    return;
  }
  el.textContent = message;
  el.classList.add("visible");
}

function isProgressStale(progress) {
  return !progress?.startedAt || Date.now() - progress.startedAt > STALE_PROGRESS_MS;
}

function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
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
    return m ? m[1].toUpperCase() : null;
  } catch {
    return null;
  }
}

function shortPath(url) {
  const asin = asinFromUrl(url);
  return asin ? `/dp/${asin}` : url;
}

function escapeHTML(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(s) {
  return escapeHTML(s).replace(/"/g, "&quot;");
}

function renderAutoRequestNote() {
  $("autoRequestNote").classList.toggle("open", $("autoRequest").checked);
}

async function persistSettings({ reschedule = false } = {}) {
  await chrome.storage.local.set({
    intervalMin: Math.max(5, parseInt($("intervalMin").value || "30", 10)),
    autoRequest: $("autoRequest").checked,
    communityDataEnabled: $("communityDataEnabled").checked,
    trackPokemonTcgFr: $("trackPokemonTcgFr").checked,
  });
  await chrome.storage.local.remove(["telemetryEnabled", "scrapeEnabled"]);
  if (reschedule) {
    await sendMessage({ type: "reschedule-alarm" });
    await refreshNextCheck();
  }
}

async function load() {
  const manifest = chrome.runtime.getManifest?.();
  const cfg = await chrome.storage.local.get([
    "intervalMin",
    "autoRequest",
    "communityDataEnabled",
    "trackPokemonTcgFr",
    "telemetryEnabled",
    "scrapeEnabled",
    "lastRun",
    "showAll",
    "checkProgress",
  ]);

  $("version").textContent = `Version ${manifest?.version || "?"}`;
  setVal("intervalMin", cfg.intervalMin || 30);
  setChecked("autoRequest", cfg.autoRequest);
  setChecked(
    "communityDataEnabled",
    cfg.communityDataEnabled == null ? (cfg.scrapeEnabled !== false || !!cfg.telemetryEnabled) : cfg.communityDataEnabled,
  );
  setChecked("trackPokemonTcgFr", cfg.trackPokemonTcgFr);
  renderAutoRequestNote();

  await refreshList(cfg.lastRun, cfg.showAll);
  await refreshNextCheck();

  if (cfg.checkProgress) {
    if (isProgressStale(cfg.checkProgress)) {
      await chrome.storage.local.remove("checkProgress");
      setError("Check precedent interrompu. Reessaie.");
    } else {
      renderCheckProgress(cfg.checkProgress);
      $("check").disabled = true;
    }
  }

  startProgressListener();
}

let progressListenerStarted = false;
function startProgressListener() {
  if (progressListenerStarted) return;
  progressListenerStarted = true;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;

    if (changes.checkProgress) {
      const next = changes.checkProgress.newValue;
      if (next) {
        renderCheckProgress(next);
        $("check").disabled = true;
      } else {
        $("check").disabled = false;
      }
    }

    if (changes.lastRun || changes.knownStates || changes.publicFeed || changes.customUrls || changes.showAll) {
      chrome.storage.local.get(["lastRun", "showAll"]).then((cfg) => refreshList(cfg.lastRun, cfg.showAll));
    }
  });
}

function renderCheckProgress(progress) {
  if (!progress) return;
  if (progress.phase === "watchlist") {
    $("sub").textContent = "Check en cours…";
    return;
  }
  if (progress.phase === "checking") {
    const name = progress.currentName ? ` · ${truncate(progress.currentName, 34)}` : "";
    $("sub").textContent = `Check en cours… ${progress.current}/${progress.total}${name}`;
  }
}

function renderHeader(items, lastRun) {
  const counts = { available: 0, already_requested: 0, accepted: 0 };
  for (const item of items) {
    const state = item.known_state || "unknown";
    if (state in counts) counts[state]++;
  }

  $("stat-available").textContent = counts.available + counts.accepted;
  $("stat-requested").textContent = counts.already_requested;
  $("stat-total").textContent = items.length;

  if (lastRun) {
    const ago = relativeTime(lastRun.ts);
    const errs = lastRun.errors ? ` · ${lastRun.errors} erreur(s)` : "";
    $("sub").textContent = `Dernier check ${ago} · ${lastRun.checked || 0} OK${errs}`;
  } else {
    $("sub").textContent = items.length ? `${items.length} produit(s) suivis` : "Surveille tes invitations sans bruit";
  }
}

function shouldHideState(state, showAll) {
  if (activeFilter !== "all") return false;
  return !showAll && HIDDEN_BY_DEFAULT.has(state);
}

function renderStatFilter() {
  document.querySelectorAll(".stat[data-filter]").forEach((el) => {
    el.classList.toggle("active", el.dataset.filter === activeFilter);
  });
}

async function refreshList(lastRun, showAllOverride) {
  const res = await sendMessage({ type: "get-watchlist" });
  if (!res?.ok) {
    setError(`Erreur : ${res?.error || "inconnue"}`);
    renderEmpty(true);
    return;
  }

  setError("");
  if (!lastRun) {
    lastRun = (await chrome.storage.local.get("lastRun")).lastRun;
  }
  const showAll = typeof showAllOverride === "boolean"
    ? showAllOverride
    : !!(await chrome.storage.local.get("showAll")).showAll;

  renderList(res.items, showAll);
  renderHeader(res.items, lastRun);
  renderStatFilter();
}

async function refreshNextCheck() {
  const res = await sendMessage({ type: "get-schedule" });
  if (!res?.ok || !res.schedule?.scheduledTime) {
    $("next-check").textContent = "Prochain check auto : non planifie";
    stopNextCheckTimer();
    return;
  }
  startNextCheckTimer(res.schedule.scheduledTime);
}

function startNextCheckTimer(scheduledTime) {
  stopNextCheckTimer();
  const render = () => {
    const remainingMs = Math.max(0, scheduledTime - Date.now());
    if (remainingMs === 0) {
      stopNextCheckTimer();
      refreshNextCheck().catch(() => {});
      return;
    }
    $("next-check").textContent = `Prochain check auto dans ${formatCountdown(remainingMs)}`;
  };
  render();
  nextCheckTimer = setInterval(render, 1000);
}

function stopNextCheckTimer() {
  if (nextCheckTimer) {
    clearInterval(nextCheckTimer);
    nextCheckTimer = null;
  }
}

function formatCountdown(ms) {
  const totalSec = Math.ceil(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function renderEmpty(visible) {
  $("list").innerHTML = "";
  $("empty").classList.toggle("visible", visible);
}

function renderEmptyContent() {
  const empty = $("empty");
  if (activeFilter === "available") {
    empty.innerHTML = `
      <span class="big">🎟️</span>
      Aucun produit disponible à afficher pour l’instant.<br />
      Active POKÉMON TCG FR pour charger le suivi automatique.
      <div style="margin-top:12px">
        <button class="button-link inline-primary" id="enablePokemonFromEmpty" type="button">Activer POKÉMON TCG FR</button>
      </div>
    `;
    const btn = $("enablePokemonFromEmpty");
    if (btn) {
      btn.addEventListener("click", async () => {
        setChecked("trackPokemonTcgFr", true);
        $("settings").classList.add("open");
        $("trackPokemonTcgFr").dispatchEvent(new Event("change"));
      });
    }
    return;
  }

  if (activeFilter === "already_requested") {
    empty.innerHTML = `
      <span class="big">🗂️</span>
      Aucune invitation déjà demandée à afficher.
    `;
    return;
  }

  empty.innerHTML = `
    <span class="big">📭</span>
    Aucun produit suivi à afficher pour l’instant.<br />
    Active POKÉMON TCG FR ou ajoute un lien Amazon en invitation.
  `;
}

function renderList(items, showAll) {
  const list = $("list");
  list.innerHTML = "";

  if (!items.length) {
    $("list-title").textContent = "Suivi";
    $("toggle-hidden").hidden = true;
    renderEmptyContent();
    renderEmpty(true);
    return;
  }

  const order = { accepted: 0, available: 1, already_requested: 2 };
  const sorted = [...items].sort((a, b) => {
    const sa = a.known_state || "z";
    const sb = b.known_state || "z";
    return (order[sa] ?? 99) - (order[sb] ?? 99);
  });

  let hiddenCount = 0;
  let rendered = 0;

  for (const item of sorted) {
    const state = item.known_state || "unknown";
    const matchesFilter =
      activeFilter === "all"
      || (activeFilter === "available" && (state === "available" || state === "accepted"))
      || state === activeFilter;

    if (!matchesFilter) continue;
    if (shouldHideState(state, showAll)) {
      hiddenCount++;
      continue;
    }

    const label = STATE_LABELS[state] || { txt: state, cls: "unknown" };
    const li = document.createElement("li");
    li.className = "product";

    const pillTag = state === "accepted"
      ? `<a class="pill ${label.cls}" href="${escapeAttr(item.url)}" target="_blank" rel="noopener">${escapeHTML(label.txt)}</a>`
      : `<span class="pill ${label.cls}">${escapeHTML(label.txt)}</span>`;
    const removeBtn = item.custom
      ? `<button class="remove" data-url="${escapeAttr(item.url)}" title="Retirer">×</button>`
      : "";

    li.innerHTML = `
      <div class="body">
        <div class="name">${escapeHTML(item.name || asinFromUrl(item.url) || item.url)}</div>
        <div class="link"><a href="${escapeAttr(item.url)}" target="_blank" rel="noopener">${escapeHTML(shortPath(item.url))}</a></div>
      </div>
      ${pillTag}
      ${removeBtn}
    `;
    list.appendChild(li);
    rendered++;
  }

  list.querySelectorAll(".remove").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const url = e.currentTarget.dataset.url;
      await sendMessage({ type: "remove-custom-url", url });
      await refreshList();
    });
  });

  const toggle = $("toggle-hidden");
  if (hiddenCount > 0) {
    toggle.hidden = false;
    toggle.textContent = showAll ? "Masquer le reste" : `Afficher ${hiddenCount} masque(s)`;
  } else {
    toggle.hidden = true;
  }

  $("list-title").textContent = hiddenCount && !showAll
    ? `Suivi · ${rendered} visibles`
    : `Suivi · ${rendered}`;

  if (rendered === 0 && hiddenCount > 0) {
    $("empty").innerHTML = `
      <span class="big">🙈</span>
      Tout est masqué pour rester simple.<br />
      Utilise “Afficher” si tu veux voir aussi les produits déjà demandés.
    `;
    renderEmpty(true);
  } else {
    renderEmptyContent();
    renderEmpty(rendered === 0);
  }
}

$("toggle-settings").addEventListener("click", () => {
  $("settings").classList.toggle("open");
});

$("toggle-hidden").addEventListener("click", async () => {
  const next = !((await chrome.storage.local.get("showAll")).showAll);
  await chrome.storage.local.set({ showAll: next });
  await refreshList(undefined, next);
});

$("intervalMin").addEventListener("change", async () => {
  await persistSettings({ reschedule: true });
});

$("autoRequest").addEventListener("change", async () => {
  renderAutoRequestNote();
  await persistSettings();
});

$("communityDataEnabled").addEventListener("change", async () => {
  await persistSettings();
});

$("trackPokemonTcgFr").addEventListener("change", async () => {
  await persistSettings();
  activeFilter = "all";
  await chrome.storage.local.set({ showAll: true });
  if ($("trackPokemonTcgFr").checked) {
    await sendMessage({ type: "refresh-public-feed" });
  } else {
    await sendMessage({ type: "clear-public-feed" });
  }
  await refreshList();
});

$("addBtn").addEventListener("click", async () => {
  const url = $("addUrl").value.trim();
  if (!url) {
    setError("Ajoute une URL Amazon valide.");
    return;
  }

  setError("");
  $("addBtn").disabled = true;

  try {
    const res = await sendMessage({ type: "add-custom-url", url });
    if (!res?.ok) throw new Error(res?.error || "Ajout impossible");
    $("addUrl").value = "";
    const state = STATE_LABELS[res.state]?.txt || "Invitation détectée";
    $("sub").textContent = `Ajoute localement · ${state}`;
    await refreshList();
  } catch (e) {
    setError(String(e.message || e));
  } finally {
    $("addBtn").disabled = false;
  }
});

$("addUrl").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    $("addBtn").click();
  }
});

$("reset").addEventListener("click", async () => {
  if (!confirm("Reset complet : suppression de ton instanceId, de la watchlist custom et de tous les etats. Continuer ?")) return;
  await sendMessage({ type: "reset-instance" });
  window.close();
});

$("check").addEventListener("click", async () => {
  setError("");
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
  chrome.runtime.sendMessage({ type: "check-now" }, () => {
    void chrome.runtime.lastError;
    finalize();
  });
});

document.querySelectorAll(".stat[data-filter]").forEach((el) => {
  el.addEventListener("click", async () => {
    activeFilter = el.dataset.filter || "all";
    await chrome.storage.local.set({ showAll: true });
    await refreshList();
  });
});


window.addEventListener("beforeunload", stopNextCheckTimer);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", load);
} else {
  load();
}
