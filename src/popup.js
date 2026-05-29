const $ = (id) => document.getElementById(id);

let nextCheckTimer = null;
let activeFilter = "all";
let currentItems = [];
let currentLastRun = null;
let currentScanUrl = null;
let currentScanProgress = null;
let scanCdTimer = null;
let scanRunStartedAt = null;
let scanLastItemAt = null;
let scanEmaMs = null;
let scanEtaBaseMs = null;
let scanEtaBaseAt = null;
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

async function renderPokemonFeedDate() {
  const el = $("pokemonFeedDate");
  if (!el) return;
  const enabled = $("trackPokemonTcgFr")?.checked;
  if (!enabled) { el.hidden = true; return; }
  const { publicFeedFetchedAt } = await chrome.storage.local.get("publicFeedFetchedAt");
  if (!publicFeedFetchedAt) { el.hidden = true; return; }
  el.textContent = `Dernier import du feed : ${relativeTime(publicFeedFetchedAt)}`;
  el.hidden = false;
}

async function renderAmazonStatus() {
  const el = $("amazon-status");
  const warn = $("amazon-warn");
  try {
    const cookie = await chrome.cookies.get({ url: "https://www.amazon.fr", name: "at-acbfr" });
    if (cookie) {
      if (el) { el.textContent = "● Connecté Amazon"; el.className = "eyebrow connected"; }
      if (warn) warn.hidden = true;
    } else {
      if (el) { el.textContent = "● Non connecté"; el.className = "eyebrow disconnected"; }
      if (warn) warn.hidden = false;
    }
  } catch {
    if (el) { el.textContent = "● Amazon"; el.className = "eyebrow"; }
    if (warn) warn.hidden = true;
  }
}

function setupImagePreview() {
  const preview = $("img-preview");
  if (!preview) return;
  let hideTimer = null;

  document.addEventListener("mouseover", (e) => {
    const wrap = e.target.closest(".product-thumb-wrap");
    if (!wrap) return;
    const url = wrap.dataset.imgUrl;
    if (!url) return;
    clearTimeout(hideTimer);
    const rect = wrap.getBoundingClientRect();
    preview.style.backgroundImage = `url('${url}')`;
    const size = 130;
    let top = rect.top + rect.height / 2 - size / 2;
    let left = rect.left - size - 8;
    if (left < 0) left = rect.right + 8;
    top = Math.max(8, Math.min(top, window.innerHeight - size - 8));
    preview.style.top = `${top}px`;
    preview.style.left = `${left}px`;
    preview.classList.add("visible");
  });

  document.addEventListener("mouseout", (e) => {
    const wrap = e.target.closest(".product-thumb-wrap");
    if (!wrap) return;
    hideTimer = setTimeout(() => preview.classList.remove("visible"), 80);
  });
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
  await renderPokemonFeedDate();
  renderAmazonStatus();
  setupImagePreview();

  await refreshList(cfg.lastRun, cfg.showAll);
  await refreshNextCheck();

  if (cfg.checkProgress) {
    if (isProgressStale(cfg.checkProgress)) {
      await chrome.storage.local.remove("checkProgress");
      setError("Check precedent interrompu. Reessaie.");
    } else {
      currentScanUrl = cfg.checkProgress.currentUrl || null;
      scanRunStartedAt = Date.now();
      scanLastItemAt = Date.now();
      currentScanProgress = cfg.checkProgress.phase === "checking"
        ? { current: cfg.checkProgress.current, total: cfg.checkProgress.total, startedAt: cfg.checkProgress.startedAt, waitMs: cfg.checkProgress.waitMs || null, phase: cfg.checkProgress.phase }
        : null;
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
        const newScanUrl = next.currentUrl || null;
        const newProgress = (next.phase === "checking" || next.phase === "waiting")
          ? { current: next.current, total: next.total, startedAt: next.startedAt, waitMs: next.waitMs || null, phase: next.phase }
          : null;
        if (newProgress && !scanRunStartedAt) scanRunStartedAt = Date.now();
        const urlChanged = newScanUrl !== currentScanUrl;
        const progressChanged = newProgress?.current !== currentScanProgress?.current;
        currentScanUrl = newScanUrl;
        currentScanProgress = newProgress;
        if (urlChanged || progressChanged) {
          if (progressChanged && currentScanProgress) {
            const now = Date.now();
            if (scanLastItemAt) {
              const cycleMs = now - scanLastItemAt;
              scanEmaMs = scanEmaMs === null ? cycleMs : scanEmaMs * 0.7 + cycleMs * 0.3;
            }
            scanLastItemAt = now;
            if (scanEmaMs !== null) {
              scanEtaBaseMs = (currentScanProgress.total - currentScanProgress.current) * scanEmaMs;
              scanEtaBaseAt = now;
            }
          }
          rerenderCurrentList();
          if (currentScanProgress) startScanCd();
        }
      } else {
        const hadScanUrl = currentScanUrl !== null;
        currentScanUrl = null;
        currentScanProgress = null;
        scanRunStartedAt = null;
        scanLastItemAt = null;
        scanEmaMs = null;
        scanEtaBaseMs = null;
        scanEtaBaseAt = null;
        stopScanCd();
        $("check").disabled = false;
        if (hadScanUrl) rerenderCurrentList();
      }
    }

    if (changes.lastRun || changes.knownStates || changes.publicFeed || changes.customUrls || changes.showAll) {
      chrome.storage.local.get(["lastRun", "showAll"]).then((cfg) => refreshList(cfg.lastRun, cfg.showAll));
    }
  });
}

function renderCheckProgress() {}

function renderHeader(items, lastRun) {
  const counts = { accepted: 0, to_review: 0 };
  for (const item of items) {
    const state = item.known_state || "unknown";
    if (state === "accepted") counts.accepted++;
    if (state === "unknown" || state === "stub_no_data") counts.to_review++;
  }

  $("stat-available").textContent = counts.accepted;
  $("stat-requested").textContent = counts.to_review;
  $("stat-total").textContent = items.length;

  if (lastRun) {
    const ago = relativeTime(lastRun.ts);
    const errs = lastRun.errors ? ` · ${lastRun.errors} erreur(s)` : "";
    $("sub").textContent = `Dernier check ${ago} · ${lastRun.checked || 0} OK${errs}`;
  } else {
    $("sub").textContent = "";
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
  currentItems = res.items || [];
  currentLastRun = lastRun || null;
  const showAll = typeof showAllOverride === "boolean"
    ? showAllOverride
    : !!(await chrome.storage.local.get("showAll")).showAll;

  renderList(currentItems, showAll);
  renderHeader(currentItems, currentLastRun);
  renderStatFilter();
}

async function rerenderCurrentList(showAllOverride) {
  const showAll = typeof showAllOverride === "boolean"
    ? showAllOverride
    : !!(await chrome.storage.local.get("showAll")).showAll;
  renderList(currentItems, showAll);
  renderHeader(currentItems, currentLastRun);
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

function formatEta(ms) {
  const s = Math.ceil(ms / 1000);
  if (s <= 0) return "0s";
  return s >= 60 ? `${Math.floor(s / 60)}min${s % 60 > 0 ? ` ${s % 60}s` : ""}` : `${s}s`;
}

function startScanCd() {
  stopScanCd();
  scanCdTimer = setInterval(() => {
    const cd = $("scan-cd");
    if (cd && currentScanProgress?.startedAt) {
      if (currentScanProgress.phase === "waiting" && currentScanProgress.waitMs) {
        const remaining = Math.max(0, currentScanProgress.waitMs - (Date.now() - currentScanProgress.startedAt));
        cd.textContent = `${Math.ceil(remaining / 1000)}s`;
      } else {
        cd.textContent = "…";
      }
    }
    const eta = $("scan-eta");
    if (eta && scanEtaBaseMs !== null && scanEtaBaseAt !== null) {
      const remaining = Math.max(0, scanEtaBaseMs - (Date.now() - scanEtaBaseAt));
      eta.textContent = formatEta(remaining);
    }
  }, 250);
}

function stopScanCd() {
  if (scanCdTimer) { clearInterval(scanCdTimer); scanCdTimer = null; }
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
  if (visible) {
    $("list").innerHTML = "";
  }
  $("empty").classList.toggle("visible", visible);
}

function renderEmptyContent() {
  const empty = $("empty");
  if (activeFilter === "buyable") {
    empty.innerHTML = `
      <span class="big">🎟️</span>
      Aucun produit achetable à afficher pour l’instant.<br />
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

  if (activeFilter === "to_review") {
    empty.innerHTML = `
      <span class="big">🧐</span>
      Aucun produit à vérifier pour l’instant.
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
    $("toggle-hidden").hidden = true;
    renderEmptyContent();
    renderEmpty(true);
    return;
  }

  const order = { accepted: 0, available: 1, already_requested: 2 };
  const sorted = [...items].sort((a, b) => {
    const aScanning = currentScanUrl && a.url === currentScanUrl ? 1 : 0;
    const bScanning = currentScanUrl && b.url === currentScanUrl ? 1 : 0;
    if (aScanning !== bScanning) return bScanning - aScanning;
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
      || (activeFilter === "buyable" && state === "accepted")
      || (activeFilter === "to_review" && (state === "unknown" || state === "stub_no_data"))
      || state === activeFilter;

    if (!matchesFilter) continue;
    if (shouldHideState(state, showAll)) {
      hiddenCount++;
      continue;
    }

    const label = STATE_LABELS[state] || { txt: state, cls: "unknown" };
    const li = document.createElement("li");
    const isScanning = currentScanUrl && item.url === currentScanUrl;
    li.className = isScanning ? "product scanning" : "product";

    const pillTag = state === "accepted"
      ? `<a class="pill ${label.cls}" href="${escapeAttr(item.url)}" target="_blank" rel="noopener">${escapeHTML(label.txt)}</a>`
      : `<span class="pill ${label.cls}">${escapeHTML(label.txt)}</span>`;
    const removeBtn = item.custom
      ? `<button class="remove" data-url="${escapeAttr(item.url)}" title="Retirer">×</button>`
      : "";

    const imgTag = item.image_url
      ? `<div class="product-thumb-wrap" data-img-url="${escapeAttr(item.image_url)}"><img class="product-thumb" src="${escapeAttr(item.image_url)}" alt="" loading="lazy" /></div>`
      : `<div class="product-thumb-wrap product-thumb-empty"></div>`;

    let scanTag = "";
    if (isScanning && currentScanProgress) {
      const { current, total } = currentScanProgress;
      const pct = total > 0 ? Math.round((current / total) * 100) : 0;
      scanTag = `<div class="scan-progress">
        <span class="spin"></span>
        <span>${current}/${total}</span>
        <div class="scan-bar"><div class="scan-bar-fill" style="width:${pct}%"></div></div>
        <span id="scan-cd" class="scan-cd"></span>
        <span id="scan-eta" class="scan-eta"></span>
      </div>`;
    }

    li.innerHTML = `
      ${imgTag}
      <div class="body">
        <div class="name" title="${escapeAttr(item.name || asinFromUrl(item.url) || item.url)}">${escapeHTML(item.name || asinFromUrl(item.url) || item.url)}</div>
        <div class="link"><a href="${escapeAttr(item.url)}" target="_blank" rel="noopener"><svg class="link-icon" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 2H2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M8 1h3v3M11 1 6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>${escapeHTML(asinFromUrl(item.url) || shortPath(item.url))}</a></div>
        ${scanTag}
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
  await rerenderCurrentList(next);
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
  await renderPokemonFeedDate();
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
    if (res.added === false) {
      if (res.reason === "already_custom") {
        setError("Ce produit est déjà ajouté dans ton suivi manuel.");
      } else if (res.reason === "already_feed") {
        setError("Ce produit est déjà suivi via le feed public.");
      } else {
        setError("Ce produit est déjà suivi.");
      }
      return;
    }
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
    await rerenderCurrentList(true);
  });
});


window.addEventListener("beforeunload", stopNextCheckTimer);

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", load);
} else {
  load();
}
