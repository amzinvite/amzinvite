// Tests de non-régression pour le service worker.
// Mocke l'API chrome.* + fetch, importe background.js (qui enregistre ses
// listeners au chargement), puis pilote la logique via chrome.runtime.onMessage.
//
// Lancer : node test/background.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ─── Mock chrome ──────────────────────────────────────────────────────────
let store = {};
const noop = () => {};
const asyncNoop = async () => {};

function makeStorageArea() {
  return {
    async get(keys) {
      if (keys == null) return { ...store };
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (k in store) out[k] = store[k];
      return out;
    },
    async set(obj) { Object.assign(store, obj); },
    async remove(keys) {
      for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k];
    },
    async clear() { store = {}; },
  };
}

let messageListener = null;
let installedListener = null;
const evt = () => ({ addListener: noop });

globalThis.chrome = {
  storage: {
    local: makeStorageArea(),
    session: makeStorageArea(),
    onChanged: { addListener: noop },
  },
  runtime: {
    onMessage: { addListener: (fn) => { messageListener = fn; } },
    onInstalled: { addListener: (fn) => { installedListener = fn; } },
    onStartup: { addListener: noop },
    sendMessage: asyncNoop,
    getURL: (p) => `chrome-extension://test/${p}`,
  },
  action: { setBadgeBackgroundColor: asyncNoop, setBadgeText: asyncNoop, setTitle: asyncNoop },
  alarms: { get: async () => null, create: noop, clear: asyncNoop, onAlarm: evt() },
  notifications: {
    create: asyncNoop, clear: asyncNoop,
    onClicked: evt(), onButtonClicked: evt(), onClosed: evt(),
  },
  offscreen: { hasDocument: async () => false, createDocument: asyncNoop },
  cookies: { get: async () => null },
  tabs: { create: noop },
  declarativeNetRequest: { updateDynamicRules: asyncNoop },
};

// Pas de réseau par défaut : feed vide.
const defaultFetch = async (url, options = {}) => {
  if (url.endsWith("/api/extension/register")) {
    const scope = JSON.parse(options.body).scope;
    return {
      ok: true,
      status: 201,
      json: async () => ({
        scope,
        credentialId: scope === "instance"
          ? "00000000-0000-4000-8000-000000000001"
          : "00000000-0000-4000-8000-000000000002",
        secret: "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
        expiresAt: scope === "observations" ? Date.now() + 48 * 60 * 60 * 1000 : null,
      }),
    };
  }
  return { ok: true, status: 200, json: async () => [] };
};
globalThis.fetch = defaultFetch;

// ─── Charge le service worker (enregistre messageListener) ─────────────────
const backgroundModule = await import("../src/background.js");
assert.ok(messageListener, "le listener onMessage doit être enregistré");
assert.ok(installedListener, "le listener onInstalled doit être enregistré");

function dispatch(msg) {
  return new Promise((resolve) => {
    let settled = false;
    const sendResponse = (r) => { settled = true; resolve(r); };
    const ret = messageListener(msg, {}, sendResponse);
    if (ret !== true && !settled) resolve(undefined);
  });
}

// ─── Mini-runner ───────────────────────────────────────────────────────────
let passed = 0, failed = 0;
async function test(name, fn) {
  store = {}; // état frais par test
  globalThis.fetch = defaultFetch;
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}

const URL_A = "https://www.amazon.fr/dp/B0ABCDEF01";
const URL_B = "https://www.amazon.fr/dp/B0ABCDEF02";
const URL_BE = "https://www.amazon.com.be/dp/B0ABCDEF03";
const amazonFixture = (name) => readFileSync(new URL(`fixtures/amazon/${name}`, import.meta.url), "utf8")
  .replace("{{PADDING}}", "Contenu produit anonymisé. ".repeat(700));

console.log("identifiant d'instance :");

await test("réutilise un seul UUID lors d'appels concurrents au premier lancement", async () => {
  const ids = await Promise.all(Array.from({ length: 20 }, () => backgroundModule.getInstanceId()));
  assert.equal(new Set(ids).size, 1);
  assert.equal(store.instanceId, ids[0]);
});

console.log("\nscheduler intelligent :");

await test("le calendrier de secours ne lance des checks qu'après le début des vagues", async () => {
  const schedule = backgroundModule.fallbackWaveSchedule(Date.parse("2026-08-09T12:00:00Z"));
  assert.deepEqual(schedule.scan_offsets_minutes, [5, 35, 90, 180, 360, 720, 1380]);
  assert.ok(schedule.scan_offsets_minutes.every((offset) => offset > 0));
  assert.ok(schedule.waves.some((wave) => new Date(wave.starts_at * 1000).toISOString() === "2026-08-10T18:00:00.000Z"));
});

await test("planifie un rattrapage pendant une vague en cours", async () => {
  const now = Date.now();
  store.trackPokemonTcgFr = true;
  store.bootstrapFetchedAt = now;
  store.smartSchedule = {
    version: "test",
    waves: [{ id: "wave-now", starts_at: (now - 20 * 60000) / 1000, ends_at: (now + 23 * 3600000) / 1000 }],
    scan_offsets_minutes: [5, 35],
    jitter_minutes: 0,
    sync_interval_minutes: 360,
    custom_interval_minutes: 360,
  };
  await backgroundModule.scheduleAlarm({ force: true });
  assert.match(store.schedulerPlan.reason, /^wave_(catchup|check)$/);
  assert.ok(store.schedulerPlan.when > now);
});

await test("planifie seulement le nouveau produit quelques minutes après sa découverte", async () => {
  const now = Date.now();
  store.trackPokemonTcgFr = true;
  store.bootstrapFetchedAt = now;
  store.pendingNewFeedUrls = [URL_A];
  store.schedulerState = { newFeedCheckAt: now + 3 * 60000 };
  store.smartSchedule = {
    version: "test",
    waves: [],
    scan_offsets_minutes: [5, 35],
    jitter_minutes: 0,
    sync_interval_minutes: 360,
    custom_interval_minutes: 360,
  };
  await backgroundModule.scheduleAlarm({ force: true });
  assert.equal(store.schedulerPlan.reason, "new_feed_check");
  assert.equal(store.schedulerPlan.when, store.schedulerState.newFeedCheckAt);
});

await test("ne notifie qu'une fois la même vague finalisée", async () => {
  let notifications = 0;
  const originalCreate = chrome.notifications.create;
  chrome.notifications.create = async () => { notifications++; };
  try {
    const wave = { id: "wave-final", finalized: true, selected_users: 12, products: 2 };
    await backgroundModule.notifyFinalizedWave(wave);
    await backgroundModule.notifyFinalizedWave(wave);
    assert.equal(notifications, 1);
    assert.equal(store.lastNotifiedFinalizedWaveId, "wave-final");
    assert.equal(store.localAlerts.length, 1);
    assert.equal(store.localAlerts[0].kind, "wave_finalized");
    assert.equal(store.localAlerts[0].read, false);
  } finally {
    chrome.notifications.create = originalCreate;
  }
});

await test("expose, marque comme lues et efface les alertes locales", async () => {
  store.localAlerts = [{ id: "alert-1", title: "Test", createdAt: Date.now(), read: false }];
  const initial = await dispatch({ type: "get-local-alerts" });
  assert.equal(initial.alerts.length, 1);
  await dispatch({ type: "mark-local-alerts-read" });
  assert.equal(store.localAlerts[0].read, true);
  await dispatch({ type: "clear-local-alerts" });
  assert.deepEqual(store.localAlerts, []);
});

// ─── Tests ───────────────────────────────────────────────────────────────
console.log("export/import + défauts :");

await test("export-data renvoie les bons défauts (son ON, Pokémon FR ON)", async () => {
  const res = await dispatch({ type: "export-data" });
  assert.equal(res.ok, true);
  assert.equal(res.data.app, "amzinvite");
  assert.equal(res.data.settings.soundEnabled, true);
  assert.equal(res.data.settings.trackPokemonTcgFr, true);
  assert.equal(res.data.settings.autoRequest, false);
  assert.deepEqual(res.data.customUrls, []);
});

await test("export-data sérialise les customUrls existantes", async () => {
  store.customUrls = [{ url: URL_A, name: "Coffret A" }];
  const res = await dispatch({ type: "export-data" });
  assert.equal(res.data.customUrls.length, 1);
  assert.equal(res.data.customUrls[0].url, URL_A);
});

await test("import-data refuse un fichier invalide", async () => {
  const res = await dispatch({ type: "import-data", data: { app: "autre" } });
  assert.equal(res.ok, false);
  assert.match(res.error, /invalide/i);
});

await test("import-data ajoute les produits et applique les réglages", async () => {
  const bundle = {
    app: "amzinvite", version: 1, customUrls: [{ url: URL_A, name: "A" }, { url: URL_B, name: "B" }],
    settings: { intervalMin: 45, autoRequest: true, soundEnabled: false, trackPokemonTcgFr: false },
  };
  const res = await dispatch({ type: "import-data", data: bundle });
  assert.equal(res.ok, true);
  assert.equal(res.added, 2);
  assert.equal(store.customUrls.length, 2);
  assert.equal(store.intervalMin, undefined, "l'ancien intervalle importé doit être ignoré");
  assert.equal(store.autoRequest, true);
  assert.equal(store.soundEnabled, false);
  assert.equal(store.trackPokemonTcgFr, false);
});

await test("import-data dédoublonne par ASIN (fusion sans doublon)", async () => {
  store.customUrls = [{ url: URL_A, name: "déjà là" }];
  const bundle = {
    app: "amzinvite", customUrls: [
      { url: URL_A, name: "doublon" },         // même ASIN -> ignoré
      { url: URL_B, name: "nouveau" },         // ajouté
    ],
  };
  const res = await dispatch({ type: "import-data", data: bundle });
  assert.equal(res.added, 1, "un seul ajout attendu");
  assert.equal(store.customUrls.length, 2);
});

await test("round-trip export -> import préserve la watchlist", async () => {
  store.customUrls = [{ url: URL_A, name: "A" }, { url: URL_B, name: "B" }];
  const exp = await dispatch({ type: "export-data" });
  store = {}; // simule une nouvelle machine
  const imp = await dispatch({ type: "import-data", data: exp.data });
  assert.equal(imp.added, 2);
  assert.equal(store.customUrls.length, 2);
});

await test("get-watchlist expose les customUrls importées", async () => {
  store.customUrls = [{ url: URL_A, name: "A" }];
  store.trackPokemonTcgFr = false;
  const res = await dispatch({ type: "get-watchlist" });
  assert.equal(res.ok, true);
  assert.ok(res.items.some((i) => i.url === URL_A));
});

await test("ajoute et normalise un lien produit Amazon Belgique", async () => {
  let amazonFetches = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes("amazon.com.be")) amazonFetches++;
    return defaultFetch(url, options);
  };
  const res = await dispatch({
    type: "add-custom-url",
    url: "https://www.amazon.com.be/fr/Pokemon/gp/product/B0ABCDEF03?th=1",
  });
  assert.equal(res.ok, true);
  assert.equal(res.added, true);
  assert.equal(res.url, URL_BE);
  assert.equal(res.state, "unknown");
  assert.equal(store.customUrls[0].url, URL_BE);
  assert.equal(amazonFetches, 0, "l’ajout BE ne doit pas vérifier immédiatement la page Amazon");
});

console.log("\nauth v2 aléatoire :");

await test("détecte FR connecté même si Amazon propose un autre compte", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    url: "https://www.amazon.fr/gp/css/homepage.html",
    text: async () => '<a id="nav-link-accountList">Bonjour Mathieu</a><a href="/ap/signin">Utiliser un compte différent</a><h1>Votre compte</h1>',
  });
  const res = await dispatch({ type: "check-amazon-auth", marketplaces: ["amazon.fr"] });
  assert.equal(res.statuses["amazon.fr"], "connected");
});

await test("classe une redirection Amazon signin comme déconnectée", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    url: "https://www.amazon.fr/ap/signin?openid.return_to=account",
    text: async () => "",
  });
  const res = await dispatch({ type: "check-amazon-auth", marketplaces: ["amazon.fr"] });
  assert.equal(res.statuses["amazon.fr"], "disconnected");
});

await test("enrôle un credential d'instance puis signe le feed en v2", async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/extension/register")) {
      return {
        ok: true,
        status: 201,
        json: async () => ({
          scope: "instance",
          credentialId: "11111111-1111-4111-8111-111111111111",
          secret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          expiresAt: null,
        }),
      };
    }
    return { ok: true, status: 200, json: async () => [] };
  };

  const res = await dispatch({ type: "refresh-public-feed" });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[1].options.headers["X-Auth-Version"], "2");
  assert.equal(calls[1].options.headers["X-Credential-Id"], "11111111-1111-4111-8111-111111111111");
  assert.equal(calls[1].url, "https://amzinvite-api.amzinvite.workers.dev/api/public/invitations?marketplaces=amazon.fr");
  assert.match(calls[1].options.headers["X-Sig"], /^[0-9a-f]{64}$/);
  assert.equal(store.authV2InstanceCredential.scope, "instance");
});

await test("réutilise le credential v2 stocké sans nouvel enrôlement", async () => {
  store.authV2InstanceCredential = {
    scope: "instance",
    credentialId: "22222222-2222-4222-8222-222222222222",
    secret: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    expiresAt: null,
  };
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => [] };
  };

  const res = await dispatch({ type: "refresh-public-feed" });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers["X-Credential-Id"], store.authV2InstanceCredential.credentialId);
});

await test("échoue sans fallback legacy si l'enrôlement v2 est indisponible", async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/extension/register")) {
      return { ok: false, status: 404, json: async () => ({ error: "not_found" }) };
    }
    return { ok: true, status: 200, json: async () => [] };
  };

  const res = await dispatch({ type: "refresh-public-feed" });
  assert.equal(res.ok, false);
  assert.match(res.error, /auth registration HTTP 404/);
  assert.equal(calls.length, 1);
});

await test("ré-enrôle automatiquement un credential v2 refusé", async () => {
  store.authV2InstanceCredential = {
    scope: "instance",
    credentialId: "33333333-3333-4333-8333-333333333333",
    secret: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
    expiresAt: null,
  };
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/extension/register")) {
      return {
        ok: true,
        status: 201,
        json: async () => ({
          scope: "instance",
          credentialId: "44444444-4444-4444-8444-444444444444",
          secret: "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
          expiresAt: null,
        }),
      };
    }
    if (calls.length === 1) {
      return { ok: false, status: 401, json: async () => ({ error: "unknown_credential" }) };
    }
    return { ok: true, status: 200, json: async () => [] };
  };

  const res = await dispatch({ type: "refresh-public-feed" });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].options.headers["X-Credential-Id"], "44444444-4444-4444-8444-444444444444");
});

await test("transmet passivement les observations des pages Amazon visitées", async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/extension/register")) {
      return {
        ok: true,
        status: 201,
        json: async () => ({
          scope: "observations",
          credentialId: "55555555-5555-4555-8555-555555555555",
          secret: "EEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
          expiresAt: Date.now() + 48 * 60 * 60 * 1000,
        }),
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  const res = await dispatch({
    type: "scrape-items",
    items: [{
      asin: "B0ABCDEF01",
      marketplace: "amazon.fr",
      price: 39.99,
      in_stock: true,
      stock_status: "in_stock",
    }],
  });
  assert.equal(res.ok, true);
  assert.equal(res.queued, 1);
  assert.equal(calls.length, 0);

  const duplicate = await dispatch({
    type: "scrape-items",
    items: [{
      asin: "B0ABCDEF01",
      marketplace: "amazon.fr",
      price: 39.99,
      in_stock: true,
      stock_status: "in_stock",
    }],
  });
  assert.equal(duplicate.deduped, 1);

  const flushed = await dispatch({ type: "flush-observations" });
  assert.equal(flushed.ok, true);
  assert.equal(flushed.sent, 1);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers["X-Auth-Version"], "2");
  assert.equal(calls[1].options.headers["X-Instance-Id"], undefined);
  assert.equal(store.authV2ObservationCredential.scope, "observations");
  assert.deepEqual(store.observationQueue, {});

  const alreadySent = await dispatch({
    type: "scrape-items",
    items: [{
      asin: "B0ABCDEF01",
      marketplace: "amazon.fr",
      price: 39.99,
      in_stock: true,
      stock_status: "in_stock",
    }],
  });
  assert.equal(alreadySent.deduped, 1);
  assert.equal(calls.length, 2);
});

await test("ne contrôle aucun produit absent de la watchlist", async () => {
  store.trackPokemonTcgFr = true;
  store.publicFeed = [];
  store.publicFeedFetchedAt = Date.now();
  store.communityDataEnabled = true;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    throw new Error(`fetch inattendu: ${url}`);
  };

  const result = await dispatch({ type: "check-now" });
  assert.equal(result.checked, 0);
  assert.deepEqual(result.items, []);
  assert.deepEqual(calls, []);
});

console.log("\nauto-demande :");

await test("redemande une invitation expirée actionnable et pose le cooldown après succès", async () => {
  store.customUrls = [{ url: URL_A, name: "Fixture expirée" }];
  store.trackPokemonTcgFr = false;
  store.communityDataEnabled = false;
  store.autoRequest = true;
  const html = amazonFixture("expired-requestable.html");
  let postCount = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url === URL_A) return { ok: true, status: 200, url, text: async () => html };
    if (options.method === "POST" && String(url).includes("highdemandproductcontracts")) {
      postCount++;
      return { ok: true, status: 200, text: async () => "{}" };
    }
    throw new Error(`fetch inattendu: ${url}`);
  };

  const res = await dispatch({ type: "check-now" });
  assert.equal(res.ok, true);
  assert.equal(res.items[0].autoSuccess, true);
  assert.equal(res.items[0].state, "already_requested");
  assert.equal(postCount, 1);
  assert.ok(store.autoSpawnLog?.[URL_A], "le succès doit créer un cooldown");
});

await test("un refus Amazon reste visible et ne bloque pas une nouvelle tentative", async () => {
  store.customUrls = [{ url: URL_A, name: "Fixture expirée" }];
  store.trackPokemonTcgFr = false;
  store.communityDataEnabled = false;
  store.autoRequest = true;
  const html = amazonFixture("expired-requestable.html");
  let postCount = 0;
  globalThis.fetch = async (url, options = {}) => {
    if (url === URL_A) return { ok: true, status: 200, url, text: async () => html };
    if (options.method === "POST" && String(url).includes("highdemandproductcontracts")) {
      postCount++;
      return { ok: false, status: 403, text: async () => '{"error":"fixture"}' };
    }
    throw new Error(`fetch inattendu: ${url}`);
  };

  const first = await dispatch({ type: "check-now" });
  const second = await dispatch({ type: "check-now" });
  assert.equal(first.items[0].autoError, "amazon HTTP 403");
  assert.equal(second.items[0].autoError, "amazon HTTP 403");
  assert.equal(postCount, 2, "un échec doit rester retentable au scan suivant");
  assert.equal(store.autoSpawnLog, undefined, "un échec ne doit pas créer de cooldown");
});

console.log(`\n${passed} passés, ${failed} échoués`);
process.exit(failed ? 1 : 0);
