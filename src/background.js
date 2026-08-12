// background.js — service worker MV3 d'amzinvite
//
// Architecture :
//
//   1. WATCHLIST    : feed public et URLs ajoutées manuellement par l'user
//   2. ÉTAT         : 100% local (chrome.storage.local), aucune donnée perso
//                     ne quitte le navigateur de l'user
//   3. DONNEES ANONYMES : opt-out via toggle settings. Si activé, envoie
//                     les changements d'état des invitations suivies afin
//                     d'améliorer le feed et les statistiques de vague
//   4. AUTO-REQUEST : opt-in avec disclaimer. POST direct à l'endpoint
//                     d'invitation Amazon. Aucune fenêtre ouverte, aucun clic

import { detectInvitationState, extractBuyboxText } from "./detector.js";

// ─────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────
const API_BASE = "https://amzinvite-api.amzinvite.workers.dev";
const FEED_PATH = "/api/public/invitations";
const BOOTSTRAP_PATH = "/api/extension/bootstrap";
const PUBLIC_WAVES_PATH = "/api/public/waves";
const FEEDBACK_BATCH_PATH = "/api/extension/feedback/batch";
const WAVE_STATS_URL = "https://prixtcg.fr/amzinvite/stats?source=amzinvite&utm_source=amzinvite&utm_medium=extension&utm_campaign=wave_notification";
const MARKETPLACES = Object.freeze({
  "amazon.fr": Object.freeze({
    key: "amazon.fr", code: "FR", origin: "https://www.amazon.fr",
    dataHost: "data.amazon.fr", locale: "fr-FR", setting: "trackPokemonTcgFr",
    signInUrl: "https://www.amazon.fr/gp/sign-in.html",
  }),
  "amazon.com.be": Object.freeze({
    key: "amazon.com.be", code: "BE", origin: "https://www.amazon.com.be",
    dataHost: "data.amazon.com.be", locale: "fr-BE", setting: null,
    signInUrl: "https://www.amazon.com.be/gp/sign-in.html",
  }),
});
const SUPPORTED_MARKETPLACES = Object.keys(MARKETPLACES);
const AUTH_REGISTER_PATH = "/api/extension/register";
const AUTH_V2_STORAGE_KEYS = {
  instance: "authV2InstanceCredential",
};
const authV2RegistrationPromises = new Map();
const ALARM_NAME = "invitation-check";
const WAVE_STATS_ALARM_NAME = "wave-stats-check";
const REQUEST_DELAY_MIN_MS = 7_000;
const REQUEST_DELAY_MAX_MS = 18_000;
const REQUEST_LONG_PAUSE_MIN_MS = 25_000;
const REQUEST_LONG_PAUSE_MAX_MS = 60_000;
const REQUEST_TIMEOUT_MS = 25_000;
const AUTO_SPAWN_COOLDOWN_MS = 60 * 60 * 1000;
const ALREADY_REQUESTED_RECHECK_MS = 4 * 60 * 60 * 1000;
const FEED_REFRESH_MS = 6 * 60 * 60 * 1000;
const DEFAULT_SMART_SYNC_MIN = 6 * 60;
const DEFAULT_WAVE_JITTER_MIN = 4;
const WAVE_SCAN_OFFSETS_MIN = Object.freeze([5, 20, 35, 50, 65, 80, 95, 110, 125, 150, 180, 360, 720, 1380]);
const STUB_MIN_BYTES = 15_000;
const KEEPALIVE_INTERVAL_MS = 15_000;
const BUYABLE_BADGE_BG = "#1D7A52";
const MAX_NEW_FEED_NOTIFICATIONS = 3;
const NEW_FEED_CHECK_MIN_MS = 2 * 60 * 1000;
const NEW_FEED_CHECK_MAX_MS = 10 * 60 * 1000;
const TELEMETRY_DEDUPE_MS = 60 * 60 * 1000;
const FEEDBACK_SENT_STORAGE_KEY = "feedbackSentBuckets";
const LOCAL_ALERTS_STORAGE_KEY = "localAlerts";
const MAX_LOCAL_ALERTS = 30;
let instanceIdCreationPromise = null;

function secureRandomInt(min, max) {
  const lower = Math.ceil(min);
  const upper = Math.floor(max);
  if (upper <= lower) return lower;
  const span = upper - lower + 1;
  const limit = Math.floor(0x100000000 / span) * span;
  const values = new Uint32Array(1);
  do { crypto.getRandomValues(values); } while (values[0] >= limit);
  return lower + (values[0] % span);
}

function shuffled(items) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index--) {
    const swapIndex = secureRandomInt(0, index);
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

// ─────────────────────────────────────────────────────────────────────────
// Identifiant d'instance anonyme — généré au premier lancement
// ─────────────────────────────────────────────────────────────────────────
export async function getInstanceId() {
  const { instanceId } = await chrome.storage.local.get("instanceId");
  if (instanceId) return instanceId;

  if (!instanceIdCreationPromise) {
    instanceIdCreationPromise = (async () => {
      // Un second contrôle évite qu'un autre appel, déjà en attente sur
      // chrome.storage, génère un UUID concurrent au premier démarrage.
      const latest = await chrome.storage.local.get("instanceId");
      if (latest.instanceId) return latest.instanceId;
      const fresh = crypto.randomUUID();
      await chrome.storage.local.set({ instanceId: fresh });
      return fresh;
    })().finally(() => {
      instanceIdCreationPromise = null;
    });
  }
  return instanceIdCreationPromise;
}

async function getSettings() {
  const cfg = await chrome.storage.local.get([
    "autoRequest",
    "communityDataEnabled",
    "trackPokemonTcgFr",
    "telemetryEnabled",
    "scrapeEnabled",
    "soundEnabled",
    "notificationsEnabled",
  ]);
  const communityDataEnabled = cfg.communityDataEnabled == null
    ? (cfg.scrapeEnabled !== false || !!cfg.telemetryEnabled)
    : !!cfg.communityDataEnabled;
  return {
    autoRequest: !!cfg.autoRequest,
    communityDataEnabled,
    trackPokemonTcgFr: cfg.trackPokemonTcgFr == null ? true : !!cfg.trackPokemonTcgFr,
    soundEnabled: cfg.soundEnabled == null ? true : !!cfg.soundEnabled,
    notificationsEnabled: cfg.notificationsEnabled == null ? true : !!cfg.notificationsEnabled,
  };
}

async function hasTrackingSources() {
  const [{ trackPokemonTcgFr }, { customUrls }] = await Promise.all([
    getSettings(),
    chrome.storage.local.get("customUrls"),
  ]);
  return !!trackPokemonTcgFr || (customUrls || []).length > 0;
}

function parisParts(date) {
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
}

function parisDateTimeToEpochMs(year, month, day, hour, minute) {
  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute);
  const initialParts = parisParts(new Date(wallClockUtc));
  const initialOffset = Date.UTC(
    initialParts.year, initialParts.month - 1, initialParts.day,
    initialParts.hour, initialParts.minute, initialParts.second,
  ) - wallClockUtc;
  const candidate = wallClockUtc - initialOffset;
  const corrected = parisParts(new Date(candidate));
  const correctedOffset = Date.UTC(
    corrected.year, corrected.month - 1, corrected.day,
    corrected.hour, corrected.minute, corrected.second,
  ) - candidate;
  return wallClockUtc - correctedOffset;
}

export function fallbackWaveSchedule(nowMs = Date.now()) {
  const current = parisParts(new Date(nowMs));
  const parisDayUtc = Date.UTC(current.year, current.month - 1, current.day);
  const slots = [
    { weekday: 1, hour: 22, minute: 0 },
    { weekday: 5, hour: 10, minute: 0 },
  ];
  const waves = [];
  for (let dayOffset = -4; dayOffset <= 10; dayOffset++) {
    const day = new Date(parisDayUtc + dayOffset * 86400000);
    for (const slot of slots) {
      if (day.getUTCDay() !== slot.weekday) continue;
      const startsAt = parisDateTimeToEpochMs(
        day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(),
        slot.hour, slot.minute,
      );
      if (startsAt + 3 * 86400000 > nowMs) {
        waves.push({ id: String(Math.floor(startsAt / 1000)), starts_at: startsAt / 1000, ends_at: startsAt / 1000 + 86400 });
      }
    }
  }
  return {
    version: "fallback-2026-08-11.2",
    timezone: "Europe/Paris",
    waves: waves.sort((left, right) => left.starts_at - right.starts_at),
    scan_offsets_minutes: [...WAVE_SCAN_OFFSETS_MIN],
    jitter_minutes: DEFAULT_WAVE_JITTER_MIN,
    sync_interval_minutes: DEFAULT_SMART_SYNC_MIN,
    custom_interval_minutes: DEFAULT_SMART_SYNC_MIN,
  };
}

function normalizedSmartSchedule(value, nowMs = Date.now()) {
  if (!value || !Array.isArray(value.waves)) return fallbackWaveSchedule(nowMs);
  return {
    version: String(value.version || "server"),
    timezone: value.timezone || "Europe/Paris",
    waves: value.waves
      .map((wave) => ({
        id: String(wave.id || wave.starts_at),
        starts_at: Number(wave.starts_at),
        ends_at: Number(wave.ends_at || Number(wave.starts_at) + 86400),
      }))
      .filter((wave) => Number.isFinite(wave.starts_at) && Number.isFinite(wave.ends_at)),
    scan_offsets_minutes: Array.isArray(value.scan_offsets_minutes) && value.scan_offsets_minutes.length
      ? value.scan_offsets_minutes.map(Number).filter((offset) => offset >= 0 && offset < 1440)
      : [...WAVE_SCAN_OFFSETS_MIN],
    jitter_minutes: Math.max(0, Math.min(30, Number(value.jitter_minutes) || DEFAULT_WAVE_JITTER_MIN)),
    sync_interval_minutes: Math.max(60, Number(value.sync_interval_minutes) || DEFAULT_SMART_SYNC_MIN),
    custom_interval_minutes: Math.max(60, Number(value.custom_interval_minutes) || DEFAULT_SMART_SYNC_MIN),
  };
}

function normalizeAmazonHostname(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/^www\./, "");
  return SUPPORTED_MARKETPLACES.includes(host) ? host : null;
}

function marketplaceFromUrl(url) {
  try { return normalizeAmazonHostname(new URL(url).hostname); }
  catch { return null; }
}

function productKey(urlOrMarketplace, maybeAsin = null) {
  const marketplace = maybeAsin ? normalizeAmazonHostname(urlOrMarketplace) : marketplaceFromUrl(urlOrMarketplace);
  const asin = maybeAsin || asinFromUrl(urlOrMarketplace);
  return marketplace && asin ? `${marketplace}:${String(asin).toUpperCase()}` : null;
}

function selectedMarketplaces(settings) {
  return SUPPORTED_MARKETPLACES.filter((key) => {
    const setting = MARKETPLACES[key].setting;
    return setting && settings[setting];
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Authentification v2 — secret aléatoire propre à l'installation.
// ─────────────────────────────────────────────────────────────────────────
async function hmacSign(payload, timestamp, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload + timestamp));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isUsableV2Credential(value, scope) {
  if (!value || value.scope !== scope) return false;
  if (!/^[0-9a-f-]{36}$/i.test(value.credentialId || "")) return false;
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(value.secret || "")) return false;
  return true;
}

async function registerV2Credential(scope, instanceId = null) {
  const body = JSON.stringify({ scope, instanceId });
  const timeout = withTimeout();
  const response = await fetch(`${API_BASE}${AUTH_REGISTER_PATH}`, {
    method: "POST",
    signal: timeout.signal,
    headers: { "Content-Type": "application/json" },
    body,
  }).finally(timeout.done);
  if (!response.ok) throw new Error(`auth registration HTTP ${response.status}`);

  const credential = await response.json();
  if (!isUsableV2Credential(credential, scope)) {
    throw new Error("auth registration returned an invalid credential");
  }
  await chrome.storage.local.set({ [AUTH_V2_STORAGE_KEYS[scope]]: credential });
  return credential;
}

async function getV2Credential(scope, instanceId = null) {
  const storageKey = AUTH_V2_STORAGE_KEYS[scope];
  const stored = (await chrome.storage.local.get(storageKey))[storageKey];
  if (isUsableV2Credential(stored, scope)) return stored;
  if (!authV2RegistrationPromises.has(scope)) {
    const registration = registerV2Credential(scope, instanceId)
      .finally(() => authV2RegistrationPromises.delete(scope));
    authV2RegistrationPromises.set(scope, registration);
  }
  return authV2RegistrationPromises.get(scope);
}

async function authHeaders(payload, scope, instanceId = null) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const credential = await getV2Credential(scope, instanceId);
  return {
    ...(instanceId ? { "X-Instance-Id": instanceId } : {}),
    "X-Auth-Version": "2",
    "X-Credential-Id": credential.credentialId,
    "X-Ts": ts,
    "X-Sig": await hmacSign(payload, ts, credential.secret),
  };
}

async function authenticatedFetch(url, options, { payload, scope, instanceId = null }) {
  let headers = await authHeaders(payload, scope, instanceId);
  let response = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), ...headers },
  });
  if (response.status === 401 && headers["X-Auth-Version"] === "2") {
    await chrome.storage.local.remove(AUTH_V2_STORAGE_KEYS[scope]);
    headers = await authHeaders(payload, scope, instanceId);
    response = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), ...headers },
    });
  }
  return response;
}

// ─────────────────────────────────────────────────────────────────────────
// Watchlist hybride : feed public + URLs custom ajoutées par l'user
// ─────────────────────────────────────────────────────────────────────────
async function refreshPublicFeed() {
  const { publicFeed: previousFeed, publicFeedFetchedAt } = await chrome.storage.local.get([
    "publicFeed",
    "publicFeedFetchedAt",
  ]);
  const settings = await getSettings();
  const marketplaces = selectedMarketplaces(settings);
  if (!marketplaces.length) {
    await chrome.storage.local.set({ publicFeed: [], publicFeedFetchedAt: Date.now() });
    return [];
  }
  const query = new URLSearchParams({ marketplaces: marketplaces.join(",") }).toString();
  const feedPayload = `${FEED_PATH}?${query}`;
  const timeout = withTimeout();
  // Requête signée HMAC (même schéma que le feedback) : la signature porte
  // sur le path, pour éviter que l'URL du feed ne soit scrapable au curl.
  const instanceId = await getInstanceId();
  const r = await authenticatedFetch(`${API_BASE}${feedPayload}`, {
    signal: timeout.signal,
  }, {
    payload: feedPayload,
    scope: "instance",
    instanceId,
  }).finally(timeout.done);
  if (!r.ok) throw new Error(`feed HTTP ${r.status}`);
  const items = await r.json();
  await chrome.storage.local.set({
    publicFeed: items,
    publicFeedFetchedAt: Date.now(),
  });
  await notifyNewPublicFeedItems(previousFeed || [], items, { canNotify: !!publicFeedFetchedAt });
  return items;
}

async function refreshBootstrap() {
  const { publicFeed: previousFeed, publicFeedFetchedAt } = await chrome.storage.local.get([
    "publicFeed", "publicFeedFetchedAt",
  ]);
  const settings = await getSettings();
  const marketplaces = selectedMarketplaces(settings);
  if (!marketplaces.length) {
    await chrome.storage.local.set({
      publicFeed: [],
      publicFeedFetchedAt: Date.now(),
      smartSchedule: fallbackWaveSchedule(),
      bootstrapFetchedAt: Date.now(),
    });
    return { invitations: [], schedule: fallbackWaveSchedule(), latest_finalized_wave: null };
  }
  const query = new URLSearchParams({ marketplaces: marketplaces.join(",") }).toString();
  const payloadPath = `${BOOTSTRAP_PATH}?${query}`;
  const timeout = withTimeout();
  const instanceId = await getInstanceId();
  const response = await authenticatedFetch(`${API_BASE}${payloadPath}`, {
    signal: timeout.signal,
  }, {
    payload: payloadPath,
    scope: "instance",
    instanceId,
  }).finally(timeout.done);
  if (!response.ok) throw new Error(`bootstrap HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.invitations)) throw new Error("bootstrap invalide");
  const schedule = normalizedSmartSchedule(payload.schedule);
  const now = Date.now();
  await chrome.storage.local.set({
    publicFeed: payload.invitations,
    publicFeedFetchedAt: now,
    bootstrapFetchedAt: now,
    smartSchedule: schedule,
    latestFinalizedWave: payload.latest_finalized_wave || null,
  });
  await notifyNewPublicFeedItems(previousFeed || [], payload.invitations, { canNotify: !!publicFeedFetchedAt });
  if (payload.latest_finalized_wave) await notifyFinalizedWave(payload.latest_finalized_wave);
  await scheduleWaveStatsAlarm(schedule);
  return { ...payload, schedule };
}

async function refreshWaveStatus() {
  const timeout = withTimeout();
  const response = await fetch(`${API_BASE}${PUBLIC_WAVES_PATH}`, {
    signal: timeout.signal,
  }).finally(timeout.done);
  if (!response.ok) throw new Error(`waves HTTP ${response.status}`);
  const payload = await response.json();
  const latest = (payload.waves || []).find((wave) => wave.finalized) || null;
  if (latest) {
    await chrome.storage.local.set({ latestFinalizedWave: latest });
    await notifyFinalizedWave(latest);
  }
  return latest;
}

async function notifyNewPublicFeedItems(previousFeed, nextFeed, { canNotify = true } = {}) {
  if (!canNotify || !Array.isArray(nextFeed) || nextFeed.length === 0) return;

  const previousKeys = new Set(
    (previousFeed || [])
      .map((item) => productKey(item?.url))
      .filter(Boolean),
  );
  const freshItems = nextFeed.filter((item) => {
    const key = productKey(item?.url);
    return key && !previousKeys.has(key);
  });
  if (!freshItems.length) return;

  const { pendingNewFeedUrls, schedulerState } = await chrome.storage.local.get([
    "pendingNewFeedUrls",
    "schedulerState",
  ]);
  const pending = new Set(pendingNewFeedUrls || []);
  for (const item of freshItems) pending.add(item.url);
  const state = { ...(schedulerState || {}) };
  if (!Number(state.newFeedCheckAt) || Number(state.newFeedCheckAt) <= Date.now()) {
    state.newFeedCheckAt = Date.now() + secureRandomInt(NEW_FEED_CHECK_MIN_MS, NEW_FEED_CHECK_MAX_MS);
  }
  await chrome.storage.local.set({
    pendingNewFeedUrls: [...pending],
    schedulerState: state,
  });

  for (const item of freshItems.slice(0, MAX_NEW_FEED_NOTIFICATIONS)) {
    const asin = asinFromUrl(item.url);
    await createProductNotification("feed_new", {
      url: item.url,
      title: "Nouveau lien Amazon dans le feed",
      message: item.name || asin,
      priority: 0,
    });
  }

  const remaining = freshItems.length - MAX_NEW_FEED_NOTIFICATIONS;
  if (remaining > 0) {
    const title = "Nouveaux liens Amazon dans le feed";
    const message = `${freshItems.length} nouveaux produits détectés, dont ${remaining} autre(s) non affiché(s).`;
    const { notificationsEnabled } = await getSettings();
    if (notificationsEnabled) {
      await chrome.notifications.create(`feed-new-summary-${Date.now()}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title,
        message,
        priority: 0,
      });
    }
    await recordLocalAlert({ kind: "feed_new", title, message });
  }
}

async function clearPublicFeed() {
  await chrome.storage.local.set({
    publicFeed: [],
    publicFeedFetchedAt: null,
  });
}

async function getWatchlist() {
  const {
    publicFeed,
    customUrls,
    knownStates,
    publicFeedFetchedAt,
    knownImages,
    knownExpiry,
  } =
    await chrome.storage.local.get([
      "publicFeed",
      "customUrls",
      "knownStates",
      "publicFeedFetchedAt",
      "knownImages",
      "knownExpiry",
    ]);
  const settings = await getSettings();
  let feed = [];
  const enabledMarketplaces = new Set(selectedMarketplaces(settings));
  if (enabledMarketplaces.size) {
    feed = (publicFeed || []).filter((item) => enabledMarketplaces.has(item.marketplace || marketplaceFromUrl(item.url)));
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
    const key = productKey(item.url);
    deduped.set(key || item.url, item);
  }
  for (const item of custom) {
    const key = productKey(item.url);
    // Les ajouts manuels priment si l'ASIN existe déjà dans le feed.
    deduped.set(key || item.url, item);
  }
  const all = [...deduped.values()];
  const images = knownImages || {};
  const expiry = knownExpiry || {};
  return all.map((it) => {
    const key = productKey(it.url);
    return {
      ...it,
      marketplace: it.marketplace || marketplaceFromUrl(it.url),
      known_state: states[key] || null,
      image_url: images[key] || null,
      expiry_info: expiry[key] || null,
    };
  });
}

async function updateActionBadge(items = null) {
  try {
    const watchlist = items || await getWatchlist();
    const buyableCount = watchlist.filter(
      (it) => it.known_state === "accepted",
    ).length;
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
  const key = productKey(url);
  if (!key) return;
  const { knownStates } = await chrome.storage.local.get("knownStates");
  const next = { ...(knownStates || {}), [key]: state };
  await chrome.storage.local.set({ knownStates: next });
}

function extractExpiryTextFromHtml(html) {
  if (!html) return null;
  const m = html.match(/id="expiryTime"[^>]*>([^<]+)</i);
  if (m?.[1]?.trim()) return m[1].trim();
  const m2 = html.match(/vous\s+avez\s+([^<]{3,60}?)\s+avant\s+l.expiration/i);
  if (m2?.[1]) return m2[1].replace(/<[^>]+>/g, "").trim();
  return null;
}

async function setKnownExpiry(url, expiryText) {
  const key = productKey(url);
  if (!key) return;
  const { knownExpiry } = await chrome.storage.local.get("knownExpiry");
  const next = { ...(knownExpiry || {}) };
  if (expiryText) {
    next[key] = { text: expiryText, checkedAt: Date.now() };
  } else {
    delete next[key];
  }
  await chrome.storage.local.set({ knownExpiry: next });
}

async function getLastStateCheckAt(url) {
  const key = productKey(url);
  if (!key) return 0;
  const { stateCheckedAt } = await chrome.storage.local.get("stateCheckedAt");
  return stateCheckedAt?.[key] || 0;
}

async function markStateChecked(url) {
  const key = productKey(url);
  if (!key) return;
  const { stateCheckedAt } = await chrome.storage.local.get("stateCheckedAt");
  const next = { ...(stateCheckedAt || {}), [key]: Date.now() };
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
  const marketplace = normalizeAmazonHostname(parsed.hostname);
  if (!marketplace) {
    throw new Error("Le lien doit pointer vers Amazon France ou Amazon Belgique.");
  }
  const asin = asinFromUrl(parsed.href);
  if (!asin) {
    throw new Error("URL invalide : format /dp/ASIN ou /gp/product/ASIN attendu.");
  }
  return `${MARKETPLACES[marketplace].origin}/dp/${asin}`;
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

function extractProductPriceFromHtml(html) {
  if (!html) return null;
  // Méthode principale : .a-offscreen dans les blocs prix buybox connus
  // Amazon met le prix lisible en texte dans ce span caché ex: "55,99 €"
  const priceBlockPatterns = [
    /id="corePrice_desktop"[^]*?class="a-offscreen">([^<]+)</i,
    /id="corePriceDisplay_desktop_feature_div"[^]*?class="a-offscreen">([^<]+)</i,
    /id="corePrice_feature_div"[^]*?class="a-offscreen">([^<]+)</i,
    /id="price_inside_buybox"[^>]*>([^<]+)</i,
    /id="priceblock_ourprice"[^>]*>([^<]+)</i,
  ];
  for (const re of priceBlockPatterns) {
    const m = html.match(re);
    if (m?.[1]) {
      const raw = m[1].replace(/\s/g, "").replace("€", "").replace(",", ".");
      const val = parseFloat(raw);
      if (!isNaN(val) && val > 0) return val;
    }
  }
  return null;
}

async function storeKnownImage(url, html) {
  const key = productKey(url);
  if (!key) return;
  const { knownImages } = await chrome.storage.local.get("knownImages");
  const images = knownImages || {};
  if (images[key]) return; // déjà en cache
  const imageUrl = extractProductImageFromHtml(html);
  if (!imageUrl) return;
  images[key] = imageUrl;
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
  const marketplace = marketplaceFromUrl(url) || "amazon";
  return `product-${kind}-${marketplace}-${asin}-${Date.now()}`;
}

async function recordLocalAlert({ kind, title, message, url = null }) {
  const stored = await chrome.storage.local.get(LOCAL_ALERTS_STORAGE_KEY);
  const alerts = Array.isArray(stored[LOCAL_ALERTS_STORAGE_KEY])
    ? [...stored[LOCAL_ALERTS_STORAGE_KEY]]
    : [];
  const now = Date.now();
  const dedupeKey = `${kind || "info"}:${url || ""}:${title || ""}`;
  const duplicateIndex = alerts.findIndex((alert) =>
    alert.dedupeKey === dedupeKey && now - Number(alert.createdAt || 0) < 60 * 60 * 1000
  );
  const entry = {
    id: duplicateIndex >= 0 ? alerts[duplicateIndex].id : `alert-${now}-${secureRandomInt(1000, 9999)}`,
    kind: String(kind || "info"),
    title: String(title || "Alerte amzinvite").slice(0, 160),
    message: String(message || "").slice(0, 300),
    url: url ? String(url) : null,
    createdAt: now,
    read: false,
    count: duplicateIndex >= 0 ? Number(alerts[duplicateIndex].count || 1) + 1 : 1,
    dedupeKey,
  };
  if (duplicateIndex >= 0) alerts.splice(duplicateIndex, 1);
  alerts.unshift(entry);
  await chrome.storage.local.set({ [LOCAL_ALERTS_STORAGE_KEY]: alerts.slice(0, MAX_LOCAL_ALERTS) });
  return entry;
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
  const { notificationsEnabled } = await getSettings();
  if (notificationsEnabled) {
    const notificationId = productNotificationId(kind, url);
    await rememberNotificationUrl(notificationId, url);
    await chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message,
      priority,
      // Les invitations acceptées restent affichées jusqu'à action de l'user.
      requireInteraction: kind === "accepted",
    });
  }
  await recordLocalAlert({ kind, title, message, url });
}

export async function notifyFinalizedWave(wave) {
  if (!wave?.finalized || !wave.id) return { skipped: true };
  const { lastNotifiedFinalizedWaveId } = await chrome.storage.local.get("lastNotifiedFinalizedWaveId");
  if (String(lastNotifiedFinalizedWaveId || "") === String(wave.id)) return { deduped: true };
  const notificationId = `wave-finalized-${wave.id}`;
  const selected = Number(wave.selected_users || 0);
  const products = Number(wave.products || 0);
  const { notificationsEnabled } = await getSettings();
  if (notificationsEnabled) {
    await rememberNotificationUrl(notificationId, WAVE_STATS_URL);
    await chrome.notifications.create(notificationId, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "🌊 Stats de la vague publiées",
      message: `${selected} sélectionné(s) sur ${products} produit(s) · Voir les résultats`,
      priority: 1,
    });
  }
  await recordLocalAlert({
    kind: "wave_finalized",
    title: "🌊 Stats de la vague publiées",
    message: `${selected} sélectionné(s) sur ${products} produit(s) · Voir les résultats`,
    url: WAVE_STATS_URL,
  });
  await chrome.storage.local.set({ lastNotifiedFinalizedWaveId: String(wave.id) });
  return { sent: true, native: notificationsEnabled };
}

async function scheduleWaveStatsAlarm(scheduleValue = null) {
  const stored = scheduleValue ? {} : await chrome.storage.local.get("smartSchedule");
  const schedule = normalizedSmartSchedule(scheduleValue || stored.smartSchedule);
  const now = Date.now();
  const candidates = schedule.waves
    .map((wave) => ({ wave, when: wave.ends_at * 1000 + secureRandomInt(5, 20) * 60000 }))
    .filter((entry) => entry.when > now)
    .sort((left, right) => left.when - right.when);
  if (!candidates.length) {
    await chrome.alarms.clear(WAVE_STATS_ALARM_NAME);
    return;
  }
  await chrome.alarms.create(WAVE_STATS_ALARM_NAME, { when: candidates[0].when });
}

// ─────────────────────────────────────────────────────────────────────────
// Son d'alerte — joué via un document offscreen (le service worker MV3
// n'a pas accès à l'API Audio / WebAudio directement)
// ─────────────────────────────────────────────────────────────────────────
let creatingOffscreen = null;
async function ensureOffscreenAudio() {
  if (await chrome.offscreen.hasDocument?.()) return;
  if (creatingOffscreen) { await creatingOffscreen; return; }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["AUDIO_PLAYBACK"],
    justification: "Jouer un son d'alerte quand une invitation devient disponible ou acceptée.",
  }).finally(() => { creatingOffscreen = null; });
  await creatingOffscreen;
}

async function playAlertSound(kind) {
  const { soundEnabled } = await getSettings();
  if (!soundEnabled) return;
  try {
    await ensureOffscreenAudio();
    await chrome.runtime.sendMessage({ type: "play-sound", kind });
  } catch (e) {
    console.warn("[amzinvite] play sound failed:", e);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Feedback anonyme vers notre backend (opt-in)
// ─────────────────────────────────────────────────────────────────────────
async function sendFeedback(urlOrMarketplace, asinOrState, stateOrSource, maybeSource) {
  const calledWithUrl = String(urlOrMarketplace || "").startsWith("http");
  const marketplace = calledWithUrl ? marketplaceFromUrl(urlOrMarketplace) : normalizeAmazonHostname(urlOrMarketplace);
  const asin = calledWithUrl ? asinFromUrl(urlOrMarketplace) : asinOrState;
  const state = calledWithUrl ? asinOrState : stateOrSource;
  const source = calledWithUrl ? (stateOrSource || "bg_check") : (maybeSource || "bg_check");
  const { communityDataEnabled } = await getSettings();
  if (!communityDataEnabled || !asin || !marketplace) return;
  const now = Date.now();
  const bucket = Math.floor(now / TELEMETRY_DEDUPE_MS);
  const dedupeKey = `${bucket}:${marketplace}:${asin.toUpperCase()}:${state}:${source}`;
  const stored = await chrome.storage.local.get(FEEDBACK_SENT_STORAGE_KEY);
  const sentBuckets = stored[FEEDBACK_SENT_STORAGE_KEY] || {};
  if (sentBuckets[dedupeKey]) return { deduped: true };
  try {
    const instanceId = await getInstanceId();
    const body = JSON.stringify({ marketplace, asin, state, source, observedAt: Math.floor(now / 1000) });
    const response = await authenticatedFetch(`${API_BASE}/api/extension/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }, {
      payload: body,
      scope: "instance",
      instanceId,
    });
    if (!response.ok) throw new Error(`feedback HTTP ${response.status}`);
    const freshBuckets = Object.fromEntries(
      Object.entries(sentBuckets)
        .filter(([, timestamp]) => now - Number(timestamp) < 2 * TELEMETRY_DEDUPE_MS)
        .slice(-500),
    );
    freshBuckets[dedupeKey] = now;
    await chrome.storage.local.set({ [FEEDBACK_SENT_STORAGE_KEY]: freshBuckets });
    return { sent: true };
  } catch (e) {
    console.warn("[amzinvite] feedback failed:", e);
    return { error: String(e) };
  }
}

async function sendFeedbackBatch(items) {
  const { communityDataEnabled } = await getSettings();
  if (!communityDataEnabled || !items?.length) return { skipped: true };
  const now = Date.now();
  const bucket = Math.floor(now / TELEMETRY_DEDUPE_MS);
  const stored = await chrome.storage.local.get(FEEDBACK_SENT_STORAGE_KEY);
  const sentBuckets = stored[FEEDBACK_SENT_STORAGE_KEY] || {};
  const pending = [];
  for (const item of items) {
    const marketplace = marketplaceFromUrl(item.url);
    const asin = asinFromUrl(item.url);
    if (!marketplace || !asin) continue;
    const source = item.source || "bg_check";
    const dedupeKey = `${bucket}:${marketplace}:${asin.toUpperCase()}:${item.state}:${source}`;
    if (sentBuckets[dedupeKey]) continue;
    pending.push({
      marketplace,
      asin: asin.toUpperCase(),
      state: item.state,
      source,
      observedAt: Math.floor(now / 1000),
      dedupeKey,
      url: item.url,
    });
  }
  if (!pending.length) return { deduped: true };
  let sentCount = 0;
  try {
    const instanceId = await getInstanceId();
    for (let index = 0; index < pending.length; index += 50) {
      const chunk = pending.slice(index, index + 50);
      const body = JSON.stringify({
        items: chunk.map(({ dedupeKey: _dedupeKey, url: _url, ...item }) => item),
      });
      const response = await authenticatedFetch(`${API_BASE}${FEEDBACK_BATCH_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      }, {
        payload: body,
        scope: "instance",
        instanceId,
      });
      if (!response.ok) throw new Error(`feedback batch HTTP ${response.status}`);
      sentCount += chunk.length;
    }
    const freshBuckets = Object.fromEntries(
      Object.entries(sentBuckets)
        .filter(([, timestamp]) => now - Number(timestamp) < 2 * TELEMETRY_DEDUPE_MS)
        .slice(-500),
    );
    for (const item of pending) freshBuckets[item.dedupeKey] = now;
    await chrome.storage.local.set({ [FEEDBACK_SENT_STORAGE_KEY]: freshBuckets });
    return { sent: pending.length };
  } catch (error) {
    // Compatibilité avec le backend de production tant que la nouvelle route
    // batch n'est pas déployée : les anciennes routes restent utilisables.
    for (const item of pending.slice(sentCount)) {
      await sendFeedback(item.url, item.state, item.source);
    }
    return { fallback: true, error: String(error) };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Auto-request d'invitation — POST direct à Amazon (opt-in)
// Voir docs/ARCHITECTURE.md pour le reverse-engineering complet
// ─────────────────────────────────────────────────────────────────────────
function extractInvitationCreds(html, marketplace) {
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
  try {
    if (new URL(endpoint).hostname !== MARKETPLACES[marketplace]?.dataHost) return null;
  } catch { return null; }
  return { token: tokenMatch[1], endpoint, slateToken, marketplace };
}

async function requestInvitationDirect(creds) {
  const headers = {
    "x-api-csrf-token": creds.token,
    "Content-Type": 'application/vnd.com.amazon.api+json; type="aapi.highdemandproductcontracts.request-invite.request/v1"',
    "Accept": 'application/vnd.com.amazon.api+json; type="aapi.highdemandproductcontracts.request-invite/v1"',
    "Accept-Language": MARKETPLACES[creds.marketplace]?.locale || "fr-FR",
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
  const marketplace = marketplaceFromUrl(url);
  if (!marketplace) throw new Error("Marketplace Amazon non supportée");
  const timeout = withTimeout();
  const r = await fetch(url, {
    credentials: "include",
    redirect: "follow",
    signal: timeout.signal,
    headers: { "Accept-Language": `${MARKETPLACES[marketplace].locale},fr;q=0.9,en;q=0.6` },
  }).finally(timeout.done);
  if (!r.ok) throw new Error(`amazon HTTP ${r.status}`);
  return r.text();
}

function isStub(html) {
  return !html || html.length < STUB_MIN_BYTES
    || (!/id=["']ppd["']/i.test(html) && !/id=["']centerCol["']/i.test(html));
}

function isAmazonBlockPage(html) {
  return /captcha|api-services-support@amazon|automated access|robot check/i.test(String(html || ""));
}

// ─────────────────────────────────────────────────────────────────────────
// Alarmes + keepalive
// ─────────────────────────────────────────────────────────────────────────
export async function scheduleAlarm({ force = false } = {}) {
  if (!(await hasTrackingSources())) {
    await chrome.alarms.clear(ALARM_NAME);
    return;
  }
  const existingAlarm = await chrome.alarms.get(ALARM_NAME);
  if (!force && existingAlarm?.scheduledTime > Date.now() + 15_000) return existingAlarm;

  const stored = await chrome.storage.local.get([
    "smartSchedule", "schedulerState", "bootstrapFetchedAt", "customUrls", "lastRun", "pendingNewFeedUrls",
  ]);
  const now = Date.now();
  const schedule = normalizedSmartSchedule(stored.smartSchedule, now);
  const state = stored.schedulerState || {};
  const completedJobs = { ...(state.completedJobs || {}) };
  const jobJitter = { ...(state.jobJitter || {}) };
  const candidates = [];
  for (const [jobId, completedAt] of Object.entries(completedJobs)) {
    if (now - Number(completedAt) > 30 * 86400000) {
      delete completedJobs[jobId];
      delete jobJitter[jobId];
    }
  }

  const syncIntervalMs = schedule.sync_interval_minutes * 60000;
  const nextSyncAt = Number(stored.bootstrapFetchedAt || 0) + syncIntervalMs;
  candidates.push({
    id: "bootstrap-sync",
    reason: "bootstrap_sync",
    when: nextSyncAt > now ? nextSyncAt : now + secureRandomInt(30, 120) * 1000,
  });

  if ((stored.customUrls || []).length) {
    const customDue = Number(state.lastCustomCheckAt || 0) + schedule.custom_interval_minutes * 60000;
    candidates.push({
      id: "custom-safety",
      reason: "custom_safety",
      when: customDue > now ? customDue : now + secureRandomInt(60, 180) * 1000,
    });
  }

  if ((stored.pendingNewFeedUrls || []).length) {
    candidates.push({
      id: "new-feed-check",
      reason: "new_feed_check",
      when: Math.max(now + 15_000, Number(state.newFeedCheckAt) || now + NEW_FEED_CHECK_MIN_MS),
    });
  }

  for (const wave of schedule.waves) {
    const startsAt = wave.starts_at * 1000;
    const endsAt = wave.ends_at * 1000;
    const syncId = `wave-sync:${wave.id}`;
    if (!completedJobs[syncId] && startsAt > now) {
      candidates.push({
        id: syncId,
        reason: "wave_feed_sync",
        waveId: wave.id,
        when: Math.max(now + 30_000, startsAt - secureRandomInt(10, 20) * 60000),
      });
    }
    for (const offset of schedule.scan_offsets_minutes) {
      const id = `wave-check:${wave.id}:${offset}`;
      if (completedJobs[id]) continue;
      if (jobJitter[id] == null) jobJitter[id] = secureRandomInt(0, schedule.jitter_minutes);
      const plannedAt = startsAt + (offset + jobJitter[id]) * 60000;
      if (plannedAt > now) {
        candidates.push({ id, reason: "wave_check", waveId: wave.id, when: plannedAt });
      } else if (now < endsAt) {
        candidates.push({
          id,
          reason: "wave_catchup",
          waveId: wave.id,
          when: now + secureRandomInt(30, 120) * 1000,
        });
      } else {
        completedJobs[id] = now;
      }
    }
    // Un utilisateur qui rallume Chrome après la clôture reçoit encore un
    // contrôle de rattrapage unique pendant la fenêtre d'achat potentielle.
    const lateId = `wave-late:${wave.id}`;
    if (!completedJobs[lateId] && now >= endsAt && now < endsAt + 2 * 86400000
        && Number(stored.lastRun?.ts || 0) < startsAt) {
      candidates.push({
        id: lateId,
        reason: "wave_late_catchup",
        waveId: wave.id,
        when: now + secureRandomInt(60, 180) * 1000,
      });
    }
  }

  const next = candidates.sort((left, right) => left.when - right.when)[0];
  if (!next) {
    await chrome.alarms.clear(ALARM_NAME);
    return null;
  }
  await chrome.storage.local.set({
    schedulerState: { ...state, completedJobs, jobJitter },
    schedulerPlan: next,
    smartSchedule: schedule,
  });
  await chrome.alarms.create(ALARM_NAME, { when: next.when });
  return { scheduledTime: next.when, plan: next };
}

async function markSchedulerJobsCompleted(plan) {
  const { schedulerState, smartSchedule } = await chrome.storage.local.get(["schedulerState", "smartSchedule"]);
  const state = schedulerState || {};
  const completedJobs = { ...(state.completedJobs || {}) };
  const now = Date.now();
  if (plan?.reason?.startsWith("wave_")) {
    const schedule = normalizedSmartSchedule(smartSchedule, now);
    const wave = schedule.waves.find((item) => String(item.id) === String(plan.waveId));
    if (wave) {
      const startsAt = wave.starts_at * 1000;
      for (const offset of schedule.scan_offsets_minutes) {
        const id = `wave-check:${wave.id}:${offset}`;
        const jitter = Number(state.jobJitter?.[id] || 0);
        if (startsAt + (offset + jitter) * 60000 <= now) completedJobs[id] = now;
      }
    }
  }
  if (plan?.id) completedJobs[plan.id] = now;
  const patch = { ...state, completedJobs };
  if (plan?.reason === "custom_safety") patch.lastCustomCheckAt = now;
  await chrome.storage.local.set({ schedulerState: patch });
}

async function schedulerTick() {
  const { schedulerPlan, bootstrapFetchedAt, pendingNewFeedUrls } = await chrome.storage.local.get([
    "schedulerPlan", "bootstrapFetchedAt", "pendingNewFeedUrls",
  ]);
  const plan = schedulerPlan || { id: "recovery", reason: "bootstrap_sync" };
  if (plan.reason === "bootstrap_sync" || plan.reason === "wave_feed_sync") {
    try { await refreshBootstrap(); }
    catch (error) {
      console.warn("[amzinvite] bootstrap fallback:", error);
      try { await refreshPublicFeed(); } catch (_) {}
      try { await refreshWaveStatus(); } catch (_) {}
    }
  } else if (!bootstrapFetchedAt || Date.now() - bootstrapFetchedAt > FEED_REFRESH_MS) {
    try { await refreshBootstrap(); }
    catch (_) { try { await refreshPublicFeed(); } catch (_) {} }
  }

  if (["wave_check", "wave_catchup", "wave_late_catchup"].includes(plan.reason)) {
    await runCheck({ scheduled: true });
  } else if (plan.reason === "new_feed_check") {
    const result = await runCheck({ scheduled: true, onlyUrls: pendingNewFeedUrls || [] });
    if (!result.blocked) {
      const { schedulerState } = await chrome.storage.local.get("schedulerState");
      const nextState = { ...(schedulerState || {}) };
      delete nextState.newFeedCheckAt;
      await chrome.storage.local.set({ pendingNewFeedUrls: [], schedulerState: nextState });
    } else {
      const { schedulerState } = await chrome.storage.local.get("schedulerState");
      await chrome.storage.local.set({
        schedulerState: {
          ...(schedulerState || {}),
          newFeedCheckAt: Date.now() + secureRandomInt(30, 90) * 60000,
        },
      });
    }
  } else if (plan.reason === "custom_safety") {
    await runCheck({ scheduled: true, customOnly: true });
  }
  await markSchedulerJobsCompleted(plan);
  await scheduleAlarm({ force: true });
}

async function reconcileSmartScheduler({ refresh = false, force = false } = {}) {
  if (refresh) {
    try { await refreshBootstrap(); }
    catch (_) {
      try { await refreshWaveStatus(); } catch (_) {}
    }
  }
  await scheduleWaveStatsAlarm();
  return scheduleAlarm({ force });
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
const DNR_RULE_IDS = [1001, 1002];
async function setupOriginRewrite() {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: DNR_RULE_IDS,
      addRules: SUPPORTED_MARKETPLACES.map((marketplace, index) => ({
        id: DNR_RULE_IDS[index],
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "origin", operation: "set", value: MARKETPLACES[marketplace].origin },
            { header: "sec-fetch-site", operation: "set", value: "same-site" },
            { header: "sec-fetch-mode", operation: "set", value: "cors" },
            { header: "sec-fetch-dest", operation: "set", value: "empty" },
            { header: "referer", operation: "set", value: `${MARKETPLACES[marketplace].origin}/` },
          ],
        },
        condition: {
          urlFilter: `||${MARKETPLACES[marketplace].dataHost}/custom/highdemandproductcontracts/`,
          resourceTypes: ["xmlhttprequest"],
        },
      })),
    });
  } catch (e) {
    console.warn("[amzinvite] DNR rule install failed:", e);
  }
}

async function migrateMarketplaceStorage() {
  await chrome.storage.local.remove("intervalMin");
  const { marketplaceStorageVersion, knownStates, knownImages, knownExpiry, stateCheckedAt } =
    await chrome.storage.local.get([
      "marketplaceStorageVersion", "knownStates", "knownImages", "knownExpiry", "stateCheckedAt",
    ]);
  const patch = {};
  if (marketplaceStorageVersion < 2) {
    patch.marketplaceStorageVersion = 2;
    for (const [name, values] of Object.entries({ knownStates, knownImages, knownExpiry, stateCheckedAt })) {
      const migrated = {};
      for (const [key, value] of Object.entries(values || {})) {
        migrated[key.includes(":") ? key : `amazon.fr:${key.toUpperCase()}`] = value;
      }
      patch[name] = migrated;
    }
  }
  if (Object.keys(patch).length) await chrome.storage.local.set(patch);
}

async function checkMarketplaceAuth(marketplace) {
  const config = MARKETPLACES[marketplace];
  if (!config) return "unknown";
  const timeout = withTimeout(12_000);
  try {
    const response = await fetch(`${config.origin}/gp/css/homepage.html`, {
      credentials: "include",
      redirect: "follow",
      signal: timeout.signal,
      headers: { "Accept-Language": config.locale },
    });
    const finalUrl = response.url || "";
    if (/\/ap\/signin/i.test(finalUrl)) return "disconnected";
    if (!response.ok) return "unknown";
    const html = await response.text();
    if (/captcha|api-services-support@amazon/i.test(html)) return "unknown";
    // Une page compte authentifiée contient encore un lien /ap/signin pour
    // « Utiliser un compte différent ». Les marqueurs positifs doivent donc
    // primer sur ce lien secondaire ; seule la redirection finale est une
    // preuve forte de déconnexion.
    if (/nav-link-accountList|Votre compte|Your Account/i.test(html)) return "connected";
    if (/\/ap\/signin|Identifiez-vous|Sign in/i.test(html)) return "disconnected";
    return "unknown";
  } catch (_) {
    return "unknown";
  } finally {
    timeout.done();
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  await migrateMarketplaceStorage();
  void scheduleAlarm();
  void setupOriginRewrite();

  const existing = await chrome.storage.local.get([
    "autoRequest",
    "communityDataEnabled",
    "trackPokemonTcgFr",
    "telemetryEnabled",
    "scrapeEnabled",
    "showAll",
    "notificationsEnabled",
  ]);
  const defaults = {};
  if (existing.autoRequest == null) defaults.autoRequest = false;
  if (existing.communityDataEnabled == null) {
    defaults.communityDataEnabled = existing.scrapeEnabled !== false || !!existing.telemetryEnabled;
  }
  if (existing.trackPokemonTcgFr == null) defaults.trackPokemonTcgFr = true;
  if (existing.showAll == null) defaults.showAll = false;
  if (existing.notificationsEnabled == null) defaults.notificationsEnabled = true;
  if (Object.keys(defaults).length) await chrome.storage.local.set(defaults);
  // Premier install avec suivi Pokémon activé : pré-remplit le feed public.
  if (defaults.trackPokemonTcgFr === true) {
    refreshPublicFeed().catch((e) => console.warn("[amzinvite] feed initial refresh failed:", e));
  }
  if (existing.telemetryEnabled != null || existing.scrapeEnabled != null) {
    await chrome.storage.local.remove(["telemetryEnabled", "scrapeEnabled"]);
  }
  await chrome.storage.local.remove([
    "authV2ObservationCredential", "observationQueue", "observationSentBuckets", "priceHistory",
  ]);
  await updateActionBadge();
  await reconcileSmartScheduler({ refresh: false, force: true });

  // Ouvre la page d'onboarding au premier install
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("onboarding.html") });
  }
});
chrome.runtime.onStartup.addListener(() => {
  void migrateMarketplaceStorage();
  void reconcileSmartScheduler({ refresh: true });
  setupOriginRewrite();
  updateActionBadge();
});
setupOriginRewrite();
void migrateMarketplaceStorage().then(() => updateActionBadge());
void scheduleAlarm();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void schedulerTick().catch((error) => {
      console.warn("[amzinvite] scheduler tick failed:", error);
      void scheduleAlarm({ force: true });
    });
  }
  if (alarm.name === WAVE_STATS_ALARM_NAME) {
    void refreshBootstrap()
      .catch(() => refreshWaveStatus())
      .finally(() => scheduleWaveStatsAlarm());
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.knownStates || changes.customUrls || changes.trackPokemonTcgFr || changes.publicFeed) {
    void updateActionBadge();
  }
  if (changes.customUrls || changes.trackPokemonTcgFr) {
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
  if (msg?.type === "get-local-alerts") {
    chrome.storage.local.get(LOCAL_ALERTS_STORAGE_KEY)
      .then((stored) => sendResponse({
        ok: true,
        alerts: Array.isArray(stored[LOCAL_ALERTS_STORAGE_KEY]) ? stored[LOCAL_ALERTS_STORAGE_KEY] : [],
      }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === "mark-local-alerts-read") {
    chrome.storage.local.get(LOCAL_ALERTS_STORAGE_KEY).then(async (stored) => {
      const alerts = (stored[LOCAL_ALERTS_STORAGE_KEY] || []).map((alert) => ({ ...alert, read: true }));
      await chrome.storage.local.set({ [LOCAL_ALERTS_STORAGE_KEY]: alerts });
      sendResponse({ ok: true });
    }).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === "clear-local-alerts") {
    chrome.storage.local.set({ [LOCAL_ALERTS_STORAGE_KEY]: [] })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === "check-amazon-auth") {
    const requested = Array.isArray(msg.marketplaces) ? msg.marketplaces : [marketplaceFromUrl(sender?.url) || "amazon.fr"];
    Promise.all(requested.filter((key) => MARKETPLACES[key]).map(async (key) => [key, await checkMarketplaceAuth(key)]))
      .then((entries) => sendResponse({ ok: true, statuses: Object.fromEntries(entries) }))
      .catch(() => sendResponse({ ok: true, statuses: {} }));
    return true;
  }
  if (msg?.type === "check-single") {
    const url = msg.url;
    (async () => {
      try {
        const normalizedUrl = normalizeAmazonProductUrl(url);
        const html = await fetchAmazonPage(normalizedUrl);
        if (isStub(html)) return sendResponse({ ok: false, error: "stub" });
        storeKnownImage(normalizedUrl, html).catch(() => {});
        const _asinSingle = asinFromUrl(normalizedUrl);
        const _priceSingle = extractProductPriceFromHtml(html);
        if (_asinSingle && _priceSingle != null) recordPrice(normalizedUrl, _priceSingle).catch(() => {});
        const { text, doc, rawHtml } = extractBuyboxText(html);
        const state = detectInvitationState(text, doc, rawHtml);
        await setKnownState(normalizedUrl, state);
        await setKnownExpiry(normalizedUrl, state === "accepted" ? extractExpiryTextFromHtml(html) : null);
        await markStateChecked(normalizedUrl);
        await sendFeedback(normalizedUrl, state, "bg_check");
        await updateActionBadge();
        sendResponse({ ok: true, url: normalizedUrl, state });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }
  if (msg?.type === "check-now") {
    runCheck({ force: true })
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === "get-schedule") {
    Promise.all([
      chrome.alarms.get(ALARM_NAME),
      chrome.storage.local.get("schedulerPlan"),
    ]).then(([alarm, stored]) => {
      sendResponse({
        ok: true,
        schedule: {
          scheduledTime: alarm?.scheduledTime || null,
          periodInMinutes: alarm?.periodInMinutes || null,
          reason: stored.schedulerPlan?.reason || null,
        },
      });
    }).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === "reschedule-alarm") {
    scheduleAlarm({ force: true }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === "reconcile-scheduler") {
    reconcileSmartScheduler({ refresh: !!msg.refresh })
      .then((schedule) => sendResponse({ ok: true, schedule }))
      .catch((error) => sendResponse({ ok: false, error: String(error) }));
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
  if (msg?.type === "report-state") {
    // Provenance content.js (page produit visitée par l'user)
    const asin = asinFromUrl(msg.url);
    void (async () => {
      try {
        await Promise.all([
          setKnownState(msg.url, msg.state),
          setKnownExpiry(msg.url, msg.state === "accepted" ? (msg.expiryText || null) : null),
          sendFeedback(msg.url, msg.state, "manual_visit"),
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
    getWatchlist()
      .then((items) => sendResponse({
        ok: true,
        items,
      }))
      .catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === "export-data") {
    exportData().then((data) => sendResponse({ ok: true, data })).catch((e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  if (msg?.type === "import-data") {
    importData(msg.data).then((res) => sendResponse({ ok: true, ...res })).catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
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
  if (marketplaceFromUrl(normalizedUrl) === "amazon.com.be") {
    return {
      normalizedUrl,
      state: "unknown",
      name: shortPath(normalizedUrl),
    };
  }
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
  const key = productKey(normalizedUrl);
  const { customUrls, publicFeed } = await chrome.storage.local.get(["customUrls", "publicFeed"]);
  const normalizedCustom = (customUrls || []).map((entry) => normalizeCustomEntry(entry));
  if (normalizedCustom.some((entry) => entry.url === normalizedUrl)) {
    return { url: normalizedUrl, state, added: false, reason: "already_custom" };
  }
  const alreadyInFeed = (publicFeed || []).some((item) => productKey(item.url) === key);
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
// Export / import — sauvegarde locale de la watchlist et des réglages
// ─────────────────────────────────────────────────────────────────────────
const EXPORT_VERSION = 2;

async function exportData() {
  const settings = await getSettings();
  const { customUrls } = await chrome.storage.local.get("customUrls");
  return {
    app: "amzinvite",
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    customUrls: (customUrls || []).map((entry) => normalizeCustomEntry(entry)),
    settings: {
      autoRequest: settings.autoRequest,
      communityDataEnabled: settings.communityDataEnabled,
      trackPokemonTcgFr: settings.trackPokemonTcgFr,
      soundEnabled: settings.soundEnabled,
      notificationsEnabled: settings.notificationsEnabled,
    },
  };
}

async function importData(data) {
  if (!data || data.app !== "amzinvite" || !Array.isArray(data.customUrls)) {
    throw new Error("Fichier de sauvegarde invalide.");
  }
  // Fusion des URLs custom (pas de re-validation réseau : on fait confiance
  // au fichier exporté). Dédoublonnage par marketplace + ASIN.
  const { customUrls } = await chrome.storage.local.get("customUrls");
  const existing = (customUrls || []).map((entry) => normalizeCustomEntry(entry));
  const seen = new Set(existing.map((e) => productKey(e.url)).filter(Boolean));
  let added = 0;
  for (const raw of data.customUrls) {
    const entry = normalizeCustomEntry(raw);
    const key = productKey(entry.url);
    if (!entry.url || (key && seen.has(key))) continue;
    if (key) seen.add(key);
    existing.push(entry);
    added++;
  }
  const patch = { customUrls: existing };
  // Réglages : appliqués seulement s'ils sont présents dans le fichier.
  const s = data.settings;
  if (s && typeof s === "object") {
    if (typeof s.autoRequest === "boolean") patch.autoRequest = s.autoRequest;
    if (typeof s.communityDataEnabled === "boolean") patch.communityDataEnabled = s.communityDataEnabled;
    if (typeof s.trackPokemonTcgFr === "boolean") patch.trackPokemonTcgFr = s.trackPokemonTcgFr;
    if (typeof s.soundEnabled === "boolean") patch.soundEnabled = s.soundEnabled;
    if (typeof s.notificationsEnabled === "boolean") patch.notificationsEnabled = s.notificationsEnabled;
  }
  await chrome.storage.local.set(patch);
  await scheduleAlarm();
  await updateActionBadge();
  return { added, total: existing.length };
}

// ─────────────────────────────────────────────────────────────────────────
// runCheck — boucle principale de vérification des invitations
// ─────────────────────────────────────────────────────────────────────────
let activeRun = null;
async function runCheck({ force = false, scheduled = false, customOnly = false, onlyUrls = null } = {}) {
  if (activeRun) return activeRun;
  startKeepalive();
  activeRun = runCheckOnce({ force, scheduled, customOnly, onlyUrls }).finally(() => {
    activeRun = null;
    stopKeepalive();
  });
  return activeRun;
}

async function runCheckOnce({ force = false, scheduled = false, customOnly = false, onlyUrls = null } = {}) {
  const summary = { checked: 0, errors: 0, items: [] };
  const feedbackItems = [];
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

  if (customOnly) {
    const { customUrls } = await chrome.storage.local.get("customUrls");
    const customKeys = new Set((customUrls || []).map((item) => productKey(normalizeCustomEntry(item).url)).filter(Boolean));
    watchlist = watchlist.filter((item) => customKeys.has(productKey(item.url)));
  }
  if (Array.isArray(onlyUrls)) {
    const allowedKeys = new Set(onlyUrls.map((url) => productKey(url)).filter(Boolean));
    watchlist = watchlist.filter((item) => allowedKeys.has(productKey(item.url)));
  }
  if (scheduled) watchlist = shuffled(watchlist);

  let requestsSinceLongPause = 0;
  let longPauseAfter = secureRandomInt(3, 7);

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
      if (isAmazonBlockPage(html)) throw new Error("amazon captcha");
      if (isStub(html)) {
        summary.items.push({ url: it.url, state: "stub_no_data" });
        if (i < watchlist.length - 1) {
          const delay = randomInterProductDelay(++requestsSinceLongPause >= longPauseAfter);
          if (requestsSinceLongPause >= longPauseAfter) {
            requestsSinceLongPause = 0;
            longPauseAfter = secureRandomInt(3, 7);
          }
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
      const asinKey = asinFromUrl(it.url);
      const scrapedPrice = extractProductPriceFromHtml(html);
      if (asinKey && scrapedPrice != null) recordPrice(it.url, scrapedPrice).catch(() => {});
      const { text, doc, rawHtml } = extractBuyboxText(html);
        const state = detectInvitationState(text, doc, rawHtml);
        const asin = asinFromUrl(it.url);
        const prevState = it.known_state || null;
        await setKnownState(it.url, state);
        await setKnownExpiry(it.url, state === "accepted" ? extractExpiryTextFromHtml(html) : null);
        await markStateChecked(it.url);
        feedbackItems.push({ url: it.url, state, source: "bg_check" });
        summary.checked++;
        summary.items.push({ url: it.url, state });

        // Auto-request si available + opt-in + cooldown OK
        if (state === "available" && (await shouldAutoSpawn(it.url))) {
          const marketplace = marketplaceFromUrl(it.url);
          const creds = extractInvitationCreds(html, marketplace);
          if (creds) {
            try {
              const result = await requestInvitationDirect(creds);
              if (result.ok) {
                await markAutoSpawned(it.url);
                await setKnownState(it.url, "already_requested");
                feedbackItems.push({ url: it.url, state: "already_requested", source: "auto_request" });
                summary.items[summary.items.length - 1].autoSuccess = true;
                summary.items[summary.items.length - 1].state = "already_requested";
                await createProductNotification("auto_request", {
                  url: it.url,
                  title: "🤖 Invitation demandée automatiquement",
                  message: it.name || asin,
                  priority: 2,
                });
              } else {
                summary.items[summary.items.length - 1].autoError = `amazon HTTP ${result.status}`;
              }
            } catch (e) {
              console.warn("[amzinvite] auto-request failed:", e);
              summary.items[summary.items.length - 1].autoError = String(e);
            }
          } else {
            summary.items[summary.items.length - 1].autoError = "invitation_credentials_missing";
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
          await playAlertSound("accepted");
        } else if (state === "available" && prevState !== "available") {
          await createProductNotification("available", {
            url: it.url,
            title: "🎟️ Invitation dispo",
            message: it.name || asin,
            priority: 1,
          });
          await playAlertSound("available");
        }
    } catch (e) {
      summary.errors++;
      summary.items.push({ url: it.url, error: String(e) });
      if (/amazon HTTP (403|429)|captcha/i.test(String(e))) {
        summary.blocked = true;
        break;
      }
    }
    if (i < watchlist.length - 1) {
      const useLongPause = ++requestsSinceLongPause >= longPauseAfter;
      const delay = randomInterProductDelay(useLongPause);
      if (useLongPause) {
        requestsSinceLongPause = 0;
        longPauseAfter = secureRandomInt(3, 7);
      }
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

  await sendFeedbackBatch(feedbackItems);
  await chrome.storage.local.set({ lastRun: { ts: Date.now(), ...summary } });
  await chrome.storage.local.remove("checkProgress");
  await updateActionBadge();
  return summary;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function randomInterProductDelay(longPause = false) {
  return longPause
    ? secureRandomInt(REQUEST_LONG_PAUSE_MIN_MS, REQUEST_LONG_PAUSE_MAX_MS)
    : secureRandomInt(REQUEST_DELAY_MIN_MS, REQUEST_DELAY_MAX_MS);
}
