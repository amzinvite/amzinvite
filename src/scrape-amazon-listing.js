// scrape-amazon-listing.js — runs on Amazon search results / category pages.
// Extracts the product cards visible on the page and POSTs them as candidates.

console.log("[alerter-scrape] listing script LOADED on", location.href);

(function () {
  function parsePrice(s) {
    return window.AlerterAmazonDom.parsePrice(s);
  }

  function extractCard(card) {
    const asin = card.getAttribute("data-asin");
    if (!asin) return null;
    // Skip sponsored & out-of-bounds
    if (card.querySelector("[class*='AdHolder'], [data-component-type='sp-sponsored-result']")) return null;

    const nameEl = card.querySelector("h2 a span, h2 span");
    const name = nameEl?.textContent?.trim();
    if (!name) return null;

    // Filtre non-TCG identique à scrapers/listing_amazon.py
    if (/\b(peluches?|figurines?|battle\s*figure|action\s*figure|select\s*figure|feature\s*figure|toupies?|clip\s*['’ʼ‘]?\s*n\s*['’ʼ‘]?\s*go|parure|drap[\s-]?housse|couverture\s*polaire|coussins?|t[-\s]?shirts?|chemises?|chaussettes|crayons?|trousses?|papeterie|cahiers?|porte[-\s]?stylo|classeurs?|sac\s*à\s*dos|costumes?|disguise|dress|serviettes?|laisse|lanceur\s*de\s*balle|pkw\s?\d+|pok[ée]mon\s*toys?|jouets?|bo[îi]tes?\s*de\s*rangement|malette)\b/i.test(name)) {
      return null;
    }

    const priceEl = card.querySelector(".a-price .a-offscreen, .a-price-whole");
    const price = priceEl ? parsePrice(priceEl.textContent) : null;

    const linkEl = card.querySelector("h2 a, a.s-no-outline, a[href*='/dp/']");
    const href = linkEl?.getAttribute("href") || "";
    const url = href.startsWith("/") ? `${location.origin}/dp/${asin}` : new URL(href, location.href).toString();

    const imgEl = card.querySelector("img.s-image, img[data-image-latency]");
    const image_url = window.AlerterAmazonDom.extractImageFromElement(imgEl);

    let in_stock = true;
    if (card.querySelector("[class*='Unavailable']")) in_stock = false;

    return {
      site: "amazon",
      url: `${location.origin}/dp/${asin}`,
      external_id: asin.toUpperCase(),
      name,
      price,
      in_stock,
      image_url,
      source_url: location.href,
    };
  }

  function scrape() {
    const cards = document.querySelectorAll("div[data-asin]:not([data-asin=''])");
    const items = [];
    cards.forEach((c) => {
      const item = extractCard(c);
      if (item) items.push(item);
    });
    return items;
  }

  // Délégation au SW pour éviter le mixed-content blocking (HTTPS → HTTP localhost).
  function post(items) {
    if (!items.length) return;
    chrome.runtime.sendMessage({ type: "scrape-items", items }, (res) => {
      void chrome.runtime.lastError;
      if (!res?.ok) {
        console.warn("[alerter-scrape] listing post failed", res?.error);
        return;
      }
      const counts = (res.outcomes || []).reduce((acc, o) => {
        acc[o.action] = (acc[o.action] || 0) + 1;
        return acc;
      }, {});
      console.log(`[alerter-scrape] listing posted ${items.length} → ${JSON.stringify(counts)}`);
    });
  }

  // Amazon listings sont parfois infinite-scroll. On scrape une fois après load
  // et on re-scrape si de nouvelles cartes apparaissent (MutationObserver).
  let postedAsins = new Set();
  function scrapeAndPostFresh() {
    const items = scrape().filter((it) => {
      if (postedAsins.has(it.external_id)) return false;
      postedAsins.add(it.external_id);
      return true;
    });
    if (items.length) post(items);
  }

  setTimeout(scrapeAndPostFresh, 2500);

  const container = document.querySelector(".s-main-slot, .s-result-list") || document.body;
  const observer = new MutationObserver(() => {
    // Debounce : on attend 1.5s d'inactivité avant de relancer un scrape
    clearTimeout(window.__alerter_scrape_t);
    window.__alerter_scrape_t = setTimeout(scrapeAndPostFresh, 1500);
  });
  observer.observe(container, { childList: true, subtree: true });
})();
