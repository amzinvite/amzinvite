// background.js — service worker MV3 d'amzinvite
//
// Architecture distribuée :
//
//   1. WATCHLIST    : combinaison d'un feed public (curé par notre scraper)
//                     et d'URLs ajoutées manuellement par l'user
//   2. ÉTAT         : 100% local (chrome.storage.local), aucune donnée perso
//                     ne quitte le navigateur de l'user
//   3. DONNEES ANONYMES : opt-out via toggle settings. Si activé, envoie
//                     des détections anonymes et des observations Amazon
//                     pour améliorer le feed et le catalogue
//   4. AUTO-REQUEST : opt-in avec disclaimer. POST direct à l'endpoint
//                     d'invitation Amazon. Aucune fenêtre ouverte, aucun clic
//   5. SCRAPING     : les content scripts scrape-amazon-* envoient les
//                     ASINs/prix/stocks observés à notre backend quand le
//                     partage anonyme est activé

import { detectInvitationState, extractBuyboxText } from "./detector.js";

// ─────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────
const API_BASE = "https://amzinvite-api.amzinvite.workers.dev";
const HMAC_SECRET = "0b950ea0a74ecd36f73218b7aef389bfe610e6053fe85371ddf4f351ff2ce89a";
const ALARM_NAME = "invitation-check";
const DEFAULT_INTERVAL_MIN = 30;
const PER_REQUEST_DELAY_MS = 8_000;
const REQUEST_TIMEOUT_MS = 25_000;
const AUTO_SPAWN_COOLDOWN_MS = 60 * 60 * 1000;
const ALREADY_REQUESTED_RECHECK_MS = 4 * 60 * 60 * 1000;
const FEED_REFRESH_MS = 30 * 60 * 1000; // 30 min
const STUB_MIN_BYTES = 15_000;
const KEEPALIVE_INTERVAL_MS = 15_000;
const BUYABLE_BADGE_BG = "#1D7A52";

// ─────────────────────────────────────────────────────────────────────────
// Identifiant d'instance anonyme — généré au premier lancement
// ─────────────────────────────────────────────────────────────────────────
async function getInstanceId() {
  const { instanceId } = await chrome.storage.local.get("instanceId");
  if (instanceId) return instanceId;
  const fresh = crypto.randomUUID();
  await chrome.storage.local.set({ instanceId: fresh });
  return fresh;
}

async function getSettings() {
  const cfg = await chrome.storage.local.get([
    "intervalMin",
    "autoRequest",
    "communityDataEnabled",
    "trackPokemonTcgFr",
    "telemetryEnabled",
    "scrapeEnabled",
  ]);
  const communityDataEnabled = cfg.communityDataEnabled == null
    ? (cfg.scrapeEnabled !== false || !!cfg.telemetryEnabled)
    : !!cfg.communityDataEnabled;
  return {
    intervalMin: cfg.intervalMin || DEFAULT_INTERVAL_MIN,
    autoRequest: !!cfg.autoRequest,
    communityDataEnabled,
    trackPokemonTcgFr: !!cfg.trackPokemonTcgFr,
  };
}

async function hasTrackingSources() {
  const [{ trackPokemonTcgFr }, { customUrls }] = await Promise.all([
    getSettings(),
    chrome.storage.local.get("customUrls"),
  ]);
  return !!trackPokemonTcgFr || (customUrls || []).length > 0;
}

// ─────────────────────────────────────────────────────────────────────────
// HMAC signing pour les endpoints de feedback (anti-bot soft)
// ─────────────────────────────────────────────────────────────────────────
async function hmacSign(payload, timestamp) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(HMAC_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload + timestamp));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─────────────────────────────────────────────────────────────────────────
// Watchlist hybride : feed public + URLs custom ajoutées par l'user
// ─────────────────────────────────────────────────────────────────────────
async function refreshPublicFeed() {
  const timeout = withTimeout();
  const r = await fetch(`${API_BASE}/api/public/invitations`, {
    signal: timeout.signal,
  }).finally(timeout.done);
  if (!r.ok) throw new Error(`feed HTTP ${r.status}`);
  const items = await r.json();
  await chrome.storage.local.set({
    publicFeed: items,
    publicFeedFetchedAt: Date.now(),
  });
  return items;
}

async function clearPublicFeed() {
  await chrome.storage.local.set({
    publicFeed: [],
    publicFeedFetchedAt: null,
  });
}

async function getWatchlist() {
  const { publicFeed, customUrls, knownStates, publicFeedFetchedAt, knownImages } =
    await chrome.storage.local.get([
      "publicFeed",
      "customUrls",
      "knownStates",
      "publicFeedFetchedAt",
      "knownImages",
    ]);
  const { trackPokemonTcgFr } = await getSettings();
  let feed = [];
  if (trackPokemonTcgFr) {
    feed = publicFeed || [];
    // Refresh si stale ou jamais fetché
    if (!publicFeedFetchedAt || Date.now() - publicFeedFetchedAt > FEED_REFRESH_MS) {
      try { feed = await refreshPublicFeed(); }
      catch (e) { console.warn("[amzinvite] feed refresh failed:", e); }
    }
  }
  const custom = (customUrls || []).map((entry) => normalizeCustomEntry(entry));
  const states = knownStates || {};
  const deduped = new Map();
  for (const item of feed) {
    const asin = asinFromUrl(item.url);
    deduped.set(asin || item.url, item);
  }
  for (const item of custom) {
    const asin = asinFromUrl(item.url);
    // Les ajouts manuels priment si l'ASIN existe déjà dans le feed.
    deduped.set(asin || item.url, item);
  }
  const all = [...deduped.values()];
  const images = knownImages || {};
  return all.map((it) => {
    const asin = asinFromUrl(it.url);
    return {
      ...it,
      known_state: states[asin] || null,
      image_url: images[asin] || null,
    };
  });
}

async function updateActionBadge(items = null) {
  try {
    const watchlist = items || await getWatchlist();
    const buyableCount = watchlist.filter((it) => it.known_state === "accepted").length;
    await chrome.action.setBadgeBackgroundColor({ color: BUYABLE_BADGE_BG });
    await chrome.action.setBadgeText({ text: buyableCount > 0 ? String(Math.min(buyableCount, 99)) : "" });
    await chrome.action.setTitle({
      title: buyableCount > 0
        ? `amzinvite — ${buyableCount} produit(s) achetable(s)`
        : "amzinvite — invitations Amazon",
    });
  } catch (e) {
    console.warn("[amzinvite] badge update failed:", e);
  }
}

async function setKnownState(url, state) {
  const asin = asinFromUrl(url);
  if (!asin) return;
  const { knownStates } = await chrome.storage.local.get("knownStates");
  const next = { ...(knownStates || {}), [asin]: state };
  await chrome.storage.local.set({ knownStates: next });
}

async function getLastStateCheckAt(url) {
  const asin = asinFromUrl(url);
  if (!asin) return 0;
  const { stateCheckedAt } = await chrome.storage.local.get("stateCheckedAt");
  return stateCheckedAt?.[asin] || 0;
}

async function markStateChecked(url) {
  const asin = asinFromUrl(url);
  if (!asin) return;
  const { stateCheckedAt } = await chrome.storage.local.get("stateCheckedAt");
  const next = { ...(stateCheckedAt || {}), [asin]: Date.now() };
  await chrome.storage.local.set({ stateCheckedAt: next });
}

function asinFromUrl(url) {
  try {
    const m = new URL(url).pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    return m ? m[1].toUpperCase() : null;
  } catch { return null; }
}

function normalizeAmazonProductUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("URL invalide.");
  }
  if (!/(^|\.)amazon\./i.test(parsed.hostname)) {
    throw new Error("Le lien doit pointer vers un produit Amazon.");
  }
  const asin = asinFromUrl(parsed.href);
  if (!asin) {
    throw new Error("URL invalide : format /dp/ASIN ou /gp/product/ASIN attendu.");
  }
  return `${parsed.origin}/dp/${asin}`;
}

function shortPath(url) {
  const asin = asinFromUrl(url);
  return asin ? `/dp/${asin}` : url;
}

function normalizeCustomEntry(entry) {
  if (typeof entry === "string") {
    return { url: entry, name: shortPath(entry), custom: true };
  }
  const url = entry?.url || "";
  return {
    url,
    name: entry?.name || shortPath(url),
    custom: true,
  };
}

function extractProductImageFromHtml(html) {
  if (!html) return null;
  // data-old-hires (highest res)
  const hires = html.match(/data-old-hires="([^"]+)"/i);
  if (hires?.[1] && hires[1].startsWith("http")) return hires[1];
  // data-a-dynamic-image — JSON map { url: [w,h] }, pick largest area
  const dynMatch = html.match(/data-a-dynamic-image="([^"]+)"/i);
  if (dynMatch?.[1]) {
    try {
      const map = JSON.parse(dynMatch[1].replace(/&quot;/g, '"'));
      const best = Object.entries(map).sort((a, b) => (b[1][0] * b[1][1]) - (a[1][0] * a[1][1]))[0];
      if (best?.[0].startsWith("http")) return best[0];
    } catch {}
  }
  // landingImage src
  const srcMatch = html.match(/id="landingImage"[^>]+src="([^"]+)"/i);
  if (srcMatch?.[1] && srcMatch[1].startsWith("http")) return srcMatch[1];
  return null;
}

async function storeKnownImage(url, html) {
  const asin = asinFromUrl(url);
  if (!asin) return;
  const { knownImages } = await chrome.storage.local.get("knownImages");
  const images = knownImages || {};
  if (images[asin]) return; // déjà en cache
  const imageUrl = extractProductImageFromHtml(html);
  if (!imageUrl) return;
  images[asin] = imageUrl;
  await chrome.storage.local.set({ knownImages: images });
}

function extractProductNameFromHtml(html) {
  if (!html) return null;
  const titleMatch = html.match(/id="productTitle"[^>]*>\s*([^<]+?)\s*</i);
  if (titleMatch?.[1]) return titleMatch[1].replace(/\s+/g, " ").trim();
  const docTitleMatch = html.match(/<title>\s*([^<]+?)\s*<\/title>/i);
  if (!docTitleMatch?.[1]) return null;
  return docTitleMatch[1]
    .replace(/\s*:\s*Amazon\.[^|]+.*$/i, "")
    .replace(/\s*-\s*Amazon\.[^|]+.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function productNotificationId(kind, url) {
  const asin = asinFromUrl(url) || "unknown";
  return `product-${kind}-${asin}-${Date.now()}`;
}

async function rememberNotificationUrl(notificationId, url) {
  const { notificationUrls } = await chrome.storage.local.get("notificationUrls");
  const next = { ...(notificationUrls || {}), [notificationId]: url };
  const entries = Object.entries(next).slice(-50);
  await chrome.storage.local.set({ notificationUrls: Object.fromEntries(entries) });
}

async function forgetNotificationUrl(notificationId) {
  const { notificationUrls } = await chrome.storage.local.get("notificationUrls");
  if (!notificationUrls?.[notificationId]) return;
  const next = { ...notificationUrls };
  delete next[notificationId];
  await chrome.storage.local.set({ notificationUrls: next });
}

async function openNotificationProduct(notificationId) {
  const { notificationUrls } = await chrome.storage.local.get("notificationUrls");
  const url = notificationUrls?.[notificationId];
  if (!url) return;
  await chrome.tabs.create({ url });
  try { await chrome.notifications.clear(notificationId); } catch (_) {}
  await forgetNotificationUrl(notificationId);
}

async function createProductNotification(kind, { url, title, message, priority = 1 }) {
  if (!url) return;
  const notificationId = productNotificationId(kind, url);
  await rememberNotificationUrl(notificationId, url);
  await chrome.notifications.create(notificationId, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title,
    message,
    priority,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Feedback anonyme vers notre backend (opt-in)
// ─────────────────────────────────────────────────────────────────────────
async function sendFeedback(asin, state, source = "bg_check") {
  const { communityDataEnabled } = await getSettings();
  if (!communityDataEnabled || !asin) return;
  try {
    const instanceId = await getInstanceId();
    const body = JSON.stringify({ asin, state, source, observedAt: Math.floor(Date.now() / 1000) });
    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = await hmacSign(body, ts);
    await fetch(`${API_BASE}/api/extension/feedback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Instance-Id": instanceId,
        "X-Ts": ts,
        "X-Sig": sig,
      },
      body,
    });
  } catch (e) {
    console.warn("[amzinvite] feedback failed:", e);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Scraping passif (opt-in) — délégué par les content scripts
// ─────────────────────────────────────────────────────────────────────────
async function forwardScrape(items) {
  const { communityDataEnabled } = await getSettings();
  if (!communityDataEnabled || !items?.length) return { skipped: true };
  try {
    // Anonymisation : pas d'instanceId envoyé avec les observations scrape,
    // juste un dayBucket hashé pour rate-limit serveur.
    const dayBucket = new Date().toISOString().slice(0, 10);
    const ts = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ items, dayBucket });
    const sig = await hmacSign(body, ts);
    await fetch(`${API_BASE}/api/extension/observations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ts": ts,
        "X-Sig": sig,
      },
      body,
    });
    return { sent: items.length };
  } catch (e) {
    console.warn("[amzinvite] scrape forward failed:", e);
    return { error: String(e) };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Auto-request d'invitation — POST direct à Amazon (opt-in)
// Voir docs/ARCHITECTURE.md pour le reverse-engineering complet
// ─────────────────────────────────────────────────────────────────────────
function extractInvitationCreds(html) {
  if (!html) return null;
  const tokenMatch = html.match(/value="([^"]+)"\s+id="hdp-ib-csrf-token"/i)
    || html.match(/id="hdp-ib-csrf-token"\s+[^>]*value="([^"]+)"/i);
  const endpointMatch = html.match(/value="([^"]+)"\s+id="hdp-ib-ajax-endpoint"/i)
    || html.match(/id="hdp-ib-ajax-endpoint"\s+[^>]*value="([^"]+)"/i);
  if (!tokenMatch || !endpointMatch) return null;
  let endpoint = endpointMatch[1];
  if (!/^https?:\/\//i.test(endpoint)) endpoint = `https://${endpoint}`;
  const slatePatterns = [
    /<meta\s+name=['"]encrypted-slate-token['"]\s+content=['"]([^'"]+)['"]/i,
    /<meta\s+content=['"]([^'"]+)['"]\s+name=['"]encrypted-slate-token['"]/i,
  ];
  let slateToken = null;
  for (const re of slatePatterns) {
    const m = html.match(re);
    if (m) { slateToken = m[1]; break; }
  }
  return { token: tokenMatch[1], endpoint, slateToken };
}

async function requestInvitationDirect(creds) {
  const headers = {
    "x-api-csrf-token": creds.token,
    "Content-Type": 'application/vnd.com.amazon.api+json; type="aapi.highdemandproductcontracts.request-invite.request/v1"',
    "Accept": 'application/vnd.com.amazon.api+json; type="aapi.highdemandproductcontracts.request-invite/v1"',
    "Accept-Language": "fr-FR",
    "priority": "u=1, i",
  };
  if (creds.slateToken) headers["x-amzn-encrypted-slate-token"] = creds.slateToken;
  const r = await fetch(creds.endpoint, {
    method: "POST",
    credentials: "include",
    redirect: "follow",
    headers,
    body: "{}",
    mode: "cors",
  });
  const text = await r.text().catch(() => "");
  return { ok: r.ok, status: r.status, body: text.slice(0, 500) };
}

async function shouldAutoSpawn(url) {
  const { autoRequest } = await getSettings();
  if (!autoRequest) return false;
  const { autoSpawnLog } = await chrome.storage.local.get("autoSpawnLog");
  const last = (autoSpawnLog || {})[url];
  return !(last && Date.now() - last < AUTO_SPAWN_COOLDOWN_MS);
}

async function markAutoSpawned(url) {
  const { autoSpawnLog } = await chrome.storage.local.get("autoSpawnLog");
  const log = autoSpawnLog || {};
  log[url] = Date.now();
  const entries = Object.entries(log).sort((a, b) => b[1] - a[1]).slice(0, 100);
  await chrome.storage.local.set({ autoSpawnLog: Object.fromEntries(entries) });
}

// ─────────────────────────────────────────────────────────────────────────
// Fetch + détection
// ─────────────────────────────────────────────────────────────────────────
function withTimeout(ms = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timeout) };
}

async function fetchAmazonPage(url) {
  const timeout = withTimeout();
  const r = await fetch(url, {
    credentials: "include",
    redirect: "follow",
    signal: timeout.signal,
    headers: { "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6" },
  }).finally(timeout.done);
  if (!r.ok) throw new Error(`amazon HTTP ${r.status}`);
  return r.text();
}

function isStub(html) {
  return !html || html.length < STUB_MIN_BYTES
    || (!/id=["']ppd["']/i.test(html) && !/id=["']centerCol["']/i.test(html));
}

// ─────────────────────────────────────────────────────────────────────────
// Alarmes + keepalive
// ─────────────────────────────────────────────────────────────────────────
async function scheduleAlarm() {
  if (!(await hasTrackingSources())) {
    await chrome.alarms.clear(ALARM_NAME);
    return;
  }
  const { intervalMin } = await getSettings();
  const jitter = 1 + (Math.random() * 0.4 - 0.2);
  const period = Math.max(5, Math.round(intervalMin * jitter));
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: period });
}

let keepaliveInterval = null;
function startKeepalive() {
  if (keepaliveInterval) return;
  const tick = () => { chrome.storage.session.set({ __ka: Date.now() }).catch(() => {}); };
  tick();
  keepaliveInterval = setInterval(tick, KEEPALIVE_INTERVAL_MS);
}
function stopKeepalive() {
  if (keepaliveInterval) { clearInterval(keepaliveInterval); keepaliveInterval = null; }
}

// ─────────────────────────────────────────────────────────────────────────
// DNR : réécriture des headers Origin/sec-fetch-* pour les POST à data.amazon
// ─────────────────────────────────────────────────────────────────────────
const DNR_RULE_ID = 1001;
async function setupOriginRewrite() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_RULE_ID],
      addRules: [{
        id: DNR_RULE_ID,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "origin", operation: "set", value: "https://www.amazon.fr" },
            { header: "sec-fetch-site", operation: "set", value: "same-site" },
            { header: "sec-fetch-mode", operation: "set", value: "cors" },
            { header: "sec-fetch-dest", operation: "set", value: "empty" },
            { header: "referer", operation: "set", value: "https://www.amazon.fr/" },
          ],
        },
        condition: {
          urlFilter: "||data.amazon.fr/custom/highdemandproductcontracts/",
          resourceTypes: ["xmlhttprequest"],
        },
      }],
    });
  } catch (e) {
    console.warn("[amzinvite] DNR rule install failed:", e);
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  scheduleAlarm();
  setupOriginRewrite();

  const existing = await chrome.storage.local.get([
    "intervalMin",
    "autoRequest",
    "communityDataEnabled",
    "trackPokemonTcgFr",
    "telemetryEnabled",
    "scrapeEnabled",
    "showAll",
  ]);
  const defaults = {};
  if (existing.intervalMin == null) defaults.intervalMin = DEFAULT_INTERVAL_MIN;
  if (existing.autoRequest == null) defaults.autoRequest = false;
  if (existing.communityDataEnabled == null) {
    defaults.communityDataEnabled = existing.scrapeEnabled !== false || !!existing.telemetryEnabled;
  }
  if (existing.trackPokemonTcgFr == null) defaults.trackPokemonTcgFr = false;
  if (existing.showAll == null) defaults.showAll = false;
  if (Object.keys(defaults).length) await chrome.storage.local.set(defaults);
  if (existing.telemetryEnabled != null || existing.scrapeEnabled != null) {
    await chrome.storage.local.remove(["telemetryEnabled", "scrapeEnabled"]);
  }
  await updateActionBadge();

  // Ouvre la page d'onboarding au premier install
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
  }
});
chrome.runtime.onStartup.addListener(() => {
  scheduleAlarm();
  setupOriginRewrite();
  updateActionBadge();
});
setupOriginRewrite();
updateActionBadge();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runCheck();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.knownStates || changes.customUrls || changes.trackPokemonTcgFr || changes.publicFeed) {
    void updateActionBadge();
  }
  if (changes.customUrls || changes.trackPokemonTcgFr || changes.intervalMin) {
    void scheduleAlarm();
  }
});

chrome.notifications.onClicked?.addListener((notificationId) => {
  void openNotificationProduct(notificationId);
});

chrome.notifications.onButtonClicked?.addListener((notificationId, buttonIndex) => {
  if (buttonIndex === 0) void openNotificationProduct(notificationId);
});

chrome.notifications.onClosed?.addListener((notificationId) => {
  void forgetNotificationUrl(notificationId);
});

// ─────────────────────────────────────────────────────────────────────────
// Messages depuis popup et content scripts
// ─────────────────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "check-now") {
    runCheck({ force: true })
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === "get-schedule") {
    chrome.alarms.get(ALARM_NAME).then((alarm) => {
      sendResponse({
        ok: true,
        schedule: {
          scheduledTime: alarm?.scheduledTime || null,
          periodInMinutes: alarm?.periodInMinutes || null,
        },
      });
    }).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === "reschedule-alarm") {
    scheduleAlarm().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "refresh-public-feed") {
    refreshPublicFeed()
      .then((items) => sendResponse({ ok: true, count: items.length }))
      .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg?.type === "clear-public-feed") {
    clearPublicFeed()
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg?.type === "scrape-items") {
    forwardScrape(msg.items)
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === "report-state") {
    // Provenance content.js (page produit visitée par l'user)
    const asin = asinFromUrl(msg.url);
    void (async () => {
      try {
        await Promise.all([
          setKnownState(msg.url, msg.state),
          sendFeedback(asin, msg.state, "manual_visit"),
        ]);
      } catch (e) {
        console.warn("[amzinvite] manual visit report failed:", e);
      }
      await updateActionBadge();
    })();
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "add-custom-url") {
    addCustomUrl(msg.url)
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }
  if (msg?.type === "remove-custom-url") {
    removeCustomUrl(msg.url).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === "get-watchlist") {
    getWatchlist().then((items) => sendResponse({ ok: true, items })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === "reset-instance") {
    chrome.storage.local.clear().then(async () => {
      await updateActionBadge([]);
      sendResponse({ ok: true });
    });
    return true;
  }
});

async function validateInvitationProductUrl(url) {
  const normalizedUrl = normalizeAmazonProductUrl(url);
  const html = await fetchAmazonPage(normalizedUrl);
  if (isStub(html)) {
    throw new Error("Amazon a renvoye une page incomplete. Reessaie dans quelques secondes.");
  }
  const { text, doc, rawHtml } = extractBuyboxText(html);
  const state = detectInvitationState(text, doc, rawHtml);
  if (state === "not_invitation") {
    throw new Error("Ce produit n'est pas actuellement en mode invitation.");
  }
  await storeKnownImage(normalizedUrl, html);
  return { normalizedUrl, state, name: extractProductNameFromHtml(html) || shortPath(normalizedUrl) };
}

async function addCustomUrl(url) {
  const { normalizedUrl, state, name } = await validateInvitationProductUrl(url);
  const asin = asinFromUrl(normalizedUrl);
  const { customUrls, publicFeed } = await chrome.storage.local.get(["customUrls", "publicFeed"]);
  const normalizedCustom = (customUrls || []).map((entry) => normalizeCustomEntry(entry));
  if (normalizedCustom.some((entry) => entry.url === normalizedUrl)) {
    return { url: normalizedUrl, state, added: false, reason: "already_custom" };
  }
  const alreadyInFeed = (publicFeed || []).some((item) => asinFromUrl(item.url) === asin);
  if (alreadyInFeed) {
    return { url: normalizedUrl, state, added: false, reason: "already_feed" };
  }
  normalizedCustom.push({ url: normalizedUrl, name });
  await chrome.storage.local.set({ customUrls: normalizedCustom });
  await setKnownState(normalizedUrl, state);
  await updateActionBadge();
  return { url: normalizedUrl, state, added: true };
}

async function removeCustomUrl(url) {
  const { customUrls } = await chrome.storage.local.get("customUrls");
  const normalizedCustom = (customUrls || []).map((entry) => normalizeCustomEntry(entry));
  await chrome.storage.local.set({
    customUrls: normalizedCustom.filter((entry) => entry.url !== url),
  });
  await updateActionBadge();
}

// ─────────────────────────────────────────────────────────────────────────
// runCheck — boucle principale de vérification des invitations
// ─────────────────────────────────────────────────────────────────────────
let activeRun = null;
async function runCheck({ force = false } = {}) {
  if (activeRun) return activeRun;
  startKeepalive();
  activeRun = runCheckOnce({ force }).finally(() => {
    activeRun = null;
    stopKeepalive();
  });
  return activeRun;
}

async function runCheckOnce({ force = false } = {}) {
  const summary = { checked: 0, errors: 0, items: [] };
  await chrome.storage.local.set({
    checkProgress: { startedAt: Date.now(), phase: "watchlist", current: 0, total: 0 },
  });

  let watchlist;
  try { watchlist = await getWatchlist(); }
  catch (e) {
    summary.errors = 1;
    summary.fatal = String(e);
    await chrome.storage.local.set({ lastRun: { ts: Date.now(), ...summary } });
    await chrome.storage.local.remove("checkProgress");
    return summary;
  }

  for (let i = 0; i < watchlist.length; i++) {
    const it = watchlist[i];
    await chrome.storage.local.set({
      checkProgress: {
        startedAt: Date.now(),
        phase: "checking",
        current: i + 1,
        total: watchlist.length,
        currentUrl: it.url,
        currentName: it.name,
      },
    });
    try {
      if (it.known_state === "already_requested" && !force) {
        const lastCheckedAt = await getLastStateCheckAt(it.url);
        if (lastCheckedAt && Date.now() - lastCheckedAt < ALREADY_REQUESTED_RECHECK_MS) {
          summary.items.push({ url: it.url, state: it.known_state, skipped: true, reason: "recently_checked" });
          continue;
        }
      }

      const html = await fetchAmazonPage(it.url);
      if (isStub(html)) {
        summary.items.push({ url: it.url, state: "stub_no_data" });
        if (i < watchlist.length - 1) {
          const delay = jitteredDelay(PER_REQUEST_DELAY_MS);
          await chrome.storage.local.set({
            checkProgress: {
              startedAt: Date.now(),
              phase: "waiting",
              current: i + 1,
              total: watchlist.length,
              currentUrl: it.url,
              currentName: it.name,
              waitMs: delay,
            },
          });
          await sleep(delay);
        }
        continue;
      }

      storeKnownImage(it.url, html).catch(() => {});
      const { text, doc, rawHtml } = extractBuyboxText(html);
      const state = detectInvitationState(text, doc, rawHtml);
      const asin = asinFromUrl(it.url);
      const prevState = it.known_state || null;
      await setKnownState(it.url, state);
      await markStateChecked(it.url);
      await sendFeedback(asin, state, "bg_check");
      summary.checked++;
      summary.items.push({ url: it.url, state });

      // Auto-request si available + opt-in + cooldown OK
      if (state === "available" && (await shouldAutoSpawn(it.url))) {
        const creds = extractInvitationCreds(html);
        if (creds) {
          await markAutoSpawned(it.url);
          try {
            const result = await requestInvitationDirect(creds);
            if (result.ok) {
              await setKnownState(it.url, "already_requested");
              await sendFeedback(asin, "already_requested", "auto_request");
              summary.items[summary.items.length - 1].autoSuccess = true;
              summary.items[summary.items.length - 1].state = "already_requested";
              await createProductNotification("auto_request", {
                url: it.url,
                title: "🤖 Invitation demandée automatiquement",
                message: it.name || asin,
                priority: 2,
              });
            }
          } catch (e) {
            console.warn("[amzinvite] auto-request failed:", e);
          }
        }
      }

      // Notif seulement lors des transitions actionnables pour eviter le spam.
      if (state === "accepted" && prevState !== "accepted") {
        await createProductNotification("accepted", {
          url: it.url,
          title: "🎉 Tu es sélectionné !",
          message: `${it.name || asin} — clique pour acheter (72h max)`,
          priority: 2,
        });
      } else if (state === "available" && prevState !== "available") {
        await createProductNotification("available", {
          url: it.url,
          title: "🎟️ Invitation dispo",
          message: it.name || asin,
          priority: 1,
        });
      }
    } catch (e) {
      summary.errors++;
      summary.items.push({ url: it.url, error: String(e) });
    }
    if (i < watchlist.length - 1) {
      const delay = jitteredDelay(PER_REQUEST_DELAY_MS);
      await chrome.storage.local.set({
        checkProgress: {
          startedAt: Date.now(),
          phase: "waiting",
          current: i + 1,
          total: watchlist.length,
          currentUrl: it.url,
          currentName: it.name,
          waitMs: delay,
        },
      });
      await sleep(delay);
    }
  }

  await chrome.storage.local.set({ lastRun: { ts: Date.now(), ...summary } });
  await chrome.storage.local.remove("checkProgress");
  await updateActionBadge();
  return summary;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function jitteredDelay(base) { return Math.max(2_000, Math.round(base * (0.75 + Math.random() * 0.5))); }
