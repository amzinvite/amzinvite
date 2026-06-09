// scrape-amazon-product.js — runs on Amazon product detail pages.
// Extracts product info (name, price, stock, ASIN, image) and POSTs to
// /api/extension/scrape. Transparent : pas de badge UI, juste de la data.

console.log("[amzinvite] product script loaded on", location.href);

(function () {
  // Stop si on est dans une fenêtre cachée déclenchée par invitation watcher :
  // content.js gère déjà la détection invitation, et son flow s'occupe de
  // poster (ou pas) selon les autres règles.
  // ⚠️ La détection IS_SPAWNED dans content.js arrive asynchrone — on ne peut
  // pas s'y fier ici. On accepte que les deux scripts tournent en parallèle :
  // ils écrivent dans des tables différentes (invitation_state vs products).

  const dom = window.AlerterAmazonDom;

  function scrape() {
    const asin = dom.extractAsin();
    const name = dom.extractName();
    if (!name) {
      console.log("[amzinvite] no product name found, skip");
      return null;
    }
    const { stock_status, in_stock } = dom.detectStockStatus();
    return {
      site: "amazon",
      url: dom.canonicalUrl(asin),
      external_id: asin,
      name,
      price: dom.extractPrice(),
      in_stock,
      stock_status,
      ean: dom.extractEan(),
      image_url: dom.extractImage(),
      source_url: location.href,
    };
  }

  // Délégation au SW : un content script en HTTPS ne peut pas fetch vers
  // http://localhost (mixed-content). Le SW background fait le fetch.
  function post(item) {
    chrome.runtime.sendMessage({ type: "scrape-items", items: [item] }, (res) => {
      void chrome.runtime.lastError;
      if (!res?.ok) {
        console.warn("[amzinvite] post failed", res?.error);
      } else {
        const action = res.outcomes?.[0]?.action;
        console.log("[amzinvite] posted", item.name, "→", action);
      }
    });
  }

  // Filtre non-TCG identique à scrape-amazon-listing.js
  const NON_TCG_RE = /\b(peluches?|figurines?|battle\s*figure|action\s*figure|select\s*figure|feature\s*figure|toupies?|clip\s*[''ʼ']?\s*n\s*[''ʼ']?\s*go|parure|drap[\s-]?housse|couverture\s*polaire|coussins?|t[-\s]?shirts?|chemises?|chaussettes|crayons?|trousses?|papeterie|cahiers?|porte[-\s]?stylo|classeurs?|sac\s*à\s*dos|costumes?|disguise|dress|serviettes?|laisse|lanceur\s*de\s*balle|pkw\s?\d+|pok[ée]mon\s*toys?|jouets?|bo[îi]tes?\s*de\s*rangement|malette)\b/i;

  function isUseful(item) {
    // stock_status est requis — sans lui l'item n'a pas de valeur pour le monitoring.
    // On attend que le buybox soit chargé (potentiellement lazy) avant d'envoyer.
    if (!item?.name || item.stock_status === null) return false;
    if (NON_TCG_RE.test(item.name)) return false;
    return true;
  }

  function scrapeWhenReady() {
    const started = Date.now();
    const timeoutMs = 10_000;
    let settled = false;
    let timer = null;
    let observer = null;

    const finish = (item) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      observer?.disconnect();
      if (item) post(item);
    };

    const attempt = () => {
      try {
        const item = scrape();
        if (isUseful(item) || Date.now() - started >= timeoutMs) finish(item);
      } catch (e) {
        console.warn("[amzinvite] error", e);
        finish(null);
      }
    };

    const root = dom.mainProductRoot();
    observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(attempt, 500);
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
    timer = setTimeout(attempt, 2500);
    setTimeout(attempt, timeoutMs);
  }

  scrapeWhenReady();
})();
