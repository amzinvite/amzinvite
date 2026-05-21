// amazon-dom.js — helpers DOM partagés par les content scripts Amazon.
// Chargé comme script classique via manifest.json, donc exposé sur window.

(function () {
  const ASIN_RE = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i;

  function parsePrice(s) {
    if (!s) return null;
    const cleaned = s.replace(/[^\d,.-]/g, "").replace(/\s/g, "");
    if (cleaned.includes(",") && !cleaned.match(/\.\d{1,2}$/)) {
      return parseFloat(cleaned.replace(/\./g, "").replace(",", "."));
    }
    const value = parseFloat(cleaned);
    return Number.isFinite(value) ? value : null;
  }

  function extractAsin(root = document) {
    const m = location.pathname.match(ASIN_RE);
    if (m) return m[1].toUpperCase();
    const el =
      root.querySelector?.("input#ASIN") ||
      root.querySelector?.("[data-asin]:not([data-asin=''])") ||
      root.querySelector?.("[data-csa-c-asin]");
    const value = el?.value || el?.getAttribute?.("data-asin") || el?.getAttribute?.("data-csa-c-asin");
    return value && /^[A-Z0-9]{10}$/i.test(value) ? value.toUpperCase() : null;
  }

  function canonicalUrl(asin) {
    if (asin) return `${location.origin}/dp/${asin}`;
    return location.origin + location.pathname;
  }

  function mainProductRoot() {
    return document.querySelector("#ppd") || document.querySelector("#centerCol") || document.body;
  }

  function extractName() {
    const el = document.querySelector("#productTitle, #title");
    return el?.textContent?.trim() || null;
  }

  function extractPrice(root = mainProductRoot()) {
    const selectors = [
      "#corePrice_desktop .a-price .a-offscreen",
      "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen",
      "#corePrice_feature_div .a-price .a-offscreen",
      ".a-price[data-a-color='base'] .a-offscreen",
      "#price_inside_buybox",
      "#priceblock_ourprice",
      "#priceblock_saleprice",
      "#priceblock_dealprice",
      "[itemprop='price']",
      ".a-price .a-offscreen",
    ];
    for (const sel of selectors) {
      const el = root.querySelector?.(sel) || document.querySelector(sel);
      const raw = el?.getAttribute?.("content") || el?.textContent;
      const price = parsePrice(raw);
      if (price !== null) return price;
    }
    return null;
  }

  function normalizeImageUrl(value) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith("data:") || trimmed === "about:blank") return null;
    return trimmed;
  }

  function pickFromSrcset(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    const entries = value
      .split(",")
      .map((part) => part.trim())
      .map((part) => {
        const bits = part.split(/\s+/);
        const url = normalizeImageUrl(bits[0]);
        const width = parseInt((bits[1] || "").replace(/[^\d]/g, ""), 10) || 0;
        return { url, width };
      })
      .filter((entry) => entry.url);
    if (!entries.length) return null;
    entries.sort((a, b) => b.width - a.width);
    return entries[0].url;
  }

  function pickFromDynamicImage(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const parsed = JSON.parse(value);
      const entries = Object.entries(parsed)
        .map(([url, size]) => {
          const dims = Array.isArray(size) ? size : [];
          return {
            url: normalizeImageUrl(url),
            score: (dims[0] || 0) * (dims[1] || 0),
          };
        })
        .filter((entry) => entry.url);
      if (!entries.length) return null;
      entries.sort((a, b) => b.score - a.score);
      return entries[0].url;
    } catch (_) {
      return null;
    }
  }

  function extractImageFromElement(el) {
    if (!el) return null;
    const directCandidates = [
      el.getAttribute("data-old-hires"),
      el.currentSrc,
      el.getAttribute("src"),
      el.getAttribute("data-src"),
      el.getAttribute("data-image-src"),
    ];
    for (const candidate of directCandidates) {
      const normalized = normalizeImageUrl(candidate);
      if (normalized) return normalized;
    }

    const srcsetCandidates = [
      el.getAttribute("srcset"),
      el.getAttribute("data-srcset"),
    ];
    for (const candidate of srcsetCandidates) {
      const picked = pickFromSrcset(candidate);
      if (picked) return picked;
    }

    const dynamicImage = pickFromDynamicImage(el.getAttribute("data-a-dynamic-image"));
    if (dynamicImage) return dynamicImage;
    return null;
  }

  function extractImage() {
    const el =
      document.querySelector("#landingImage") ||
      document.querySelector("#imgBlkFront") ||
      document.querySelector("#main-image");
    return extractImageFromElement(el);
  }

  function extractEan() {
    const rows = document.querySelectorAll(
      "#productDetails_techSpec_section_1 tr, " +
      "#productDetails_detailBullets_sections1 tr, " +
      ".prodDetTable tr, " +
      "#detailBullets_feature_div li",
    );
    for (const row of rows) {
      const txt = (row.textContent || "").toLowerCase();
      if (txt.includes("ean") || txt.includes("code-barres") || txt.includes("gtin")) {
        const m = txt.match(/\b(\d{13})\b/);
        if (m) return m[1];
      }
    }
    return null;
  }

  function detectStockStatus() {
    const ppd = mainProductRoot();
    const txt = (ppd.textContent || "").toLowerCase();

    if (
      document.querySelector("#requestInvitation") ||
      document.querySelector("#invitation_buybox") ||
      document.querySelector("[data-feature-name='requestInvitation']") ||
      document.querySelector("input[name='submit.inviteButton']") ||
      txt.includes("disponible sur invitation") ||
      txt.includes("demander une invitation") ||
      txt.includes("request an invitation")
    ) {
      return { stock_status: "invitation", in_stock: false };
    }

    const buybox =
      document.querySelector("#buybox, #desktop_buybox, #qualifiedBuybox") ||
      document.querySelector("#availability") ||
      ppd;
    const buyboxTxt = (buybox?.textContent || "").toLowerCase();

    if (buyboxTxt.match(/en\s*pr[ée]commande|précommande|pre-?order|disponible\s*le|sortie\s*pr[ée]vue/)) {
      return { stock_status: "preorder", in_stock: true };
    }
    if (buyboxTxt.match(/temporairement\s*en\s*rupture|actuellement\s*indisponible|indisponible|en\s*rupture|out\s*of\s*stock/)) {
      return { stock_status: "out_of_stock", in_stock: false };
    }
    if (
      document.querySelector("#add-to-cart-button:not([disabled]), #buy-now-button:not([disabled])") ||
      buyboxTxt.match(/en\s*stock|disponible|expédié|in\s*stock/)
    ) {
      return { stock_status: "in_stock", in_stock: true };
    }
    return { stock_status: null, in_stock: null };
  }

  window.AlerterAmazonDom = {
    parsePrice,
    extractAsin,
    canonicalUrl,
    mainProductRoot,
    extractName,
    extractPrice,
    extractImageFromElement,
    extractImage,
    extractEan,
    detectStockStatus,
  };
})();
