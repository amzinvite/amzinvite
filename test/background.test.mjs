// Tests de non-régression pour le service worker.
// Mocke l'API chrome.* + fetch, importe background.js (qui enregistre ses
// listeners au chargement), puis pilote la logique via chrome.runtime.onMessage.
//
// Lancer : node test/background.test.mjs

import assert from "node:assert/strict";

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
const evt = () => ({ addListener: noop });

globalThis.chrome = {
  storage: {
    local: makeStorageArea(),
    session: makeStorageArea(),
    onChanged: { addListener: noop },
  },
  runtime: {
    onMessage: { addListener: (fn) => { messageListener = fn; } },
    onInstalled: { addListener: noop },
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
await import("../src/background.js");
assert.ok(messageListener, "le listener onMessage doit être enregistré");

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
    settings: { intervalMin: 15, autoRequest: true, soundEnabled: false, trackPokemonTcgFr: false },
  };
  const res = await dispatch({ type: "import-data", data: bundle });
  assert.equal(res.ok, true);
  assert.equal(res.added, 2);
  assert.equal(store.customUrls.length, 2);
  assert.equal(store.intervalMin, 15);
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

await test("import-data borne intervalMin à 5 min minimum", async () => {
  const res = await dispatch({ type: "import-data", data: { app: "amzinvite", customUrls: [], settings: { intervalMin: 1 } } });
  assert.equal(res.ok, true);
  assert.equal(store.intervalMin, 5);
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

console.log("\nauth v2 aléatoire :");

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

await test("garde le fallback legacy si l'enrôlement v2 est indisponible", async () => {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith("/api/extension/register")) {
      return { ok: false, status: 404, json: async () => ({ error: "not_found" }) };
    }
    return { ok: true, status: 200, json: async () => [] };
  };

  const res = await dispatch({ type: "refresh-public-feed" });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers["X-Auth-Version"], undefined);
  assert.match(calls[1].options.headers["X-Sig"], /^[0-9a-f]{64}$/);
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

await test("utilise un credential court séparé pour les observations", async () => {
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
    items: [{ asin: "B0ABCDEF01", price: 39.99, in_stock: true }],
  });
  assert.equal(res.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.headers["X-Auth-Version"], "2");
  assert.equal(calls[1].options.headers["X-Instance-Id"], undefined);
  assert.equal(store.authV2ObservationCredential.scope, "observations");
});

console.log(`\n${passed} passés, ${failed} échoués`);
process.exit(failed ? 1 : 0);
