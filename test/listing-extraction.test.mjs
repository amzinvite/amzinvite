// Tests DOM minimaux du content script listing, sans navigateur.

import assert from "node:assert/strict";

function parsePrice(value) {
  if (!value) return null;
  const cleaned = value.replace(/[^\d,.-]/g, "").replace(/\s/g, "");
  const normalized = cleaned.includes(",") && !cleaned.match(/\.\d{1,2}$/)
    ? cleaned.replace(/\./g, "").replace(",", ".")
    : cleaned;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

globalThis.window = {
  AlerterAmazonDom: {
    parsePrice,
    extractImageFromElement: () => "https://example.test/product.jpg",
  },
};
globalThis.location = {
  origin: "https://www.amazon.fr",
  href: "https://www.amazon.fr/s?k=one+piece+op16",
};
globalThis.document = {
  body: {},
  querySelectorAll: () => [],
  querySelector: () => null,
};
globalThis.chrome = {
  runtime: { sendMessage: () => undefined, lastError: null },
};
globalThis.MutationObserver = class {
  observe() {}
};
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => undefined;

await import("../src/scrape-amazon-listing.js");

function element(text, attrs = {}) {
  return {
    textContent: text,
    currentSrc: null,
    getAttribute: (name) => attrs[name] ?? null,
  };
}

function card({ offscreen = "11,99 €", whole = "11,", fraction = "99" } = {}) {
  const title = element(
    "One Piece Card Game OP-16 Booster Double Pack français",
    { href: "/dp/B0H6B7WYGG" },
  );
  const brand = element("Asmodee");
  const price = offscreen == null ? null : element(offscreen);
  const image = element("", { src: "https://example.test/product.jpg" });
  const bySelector = new Map([
    ["a.s-line-clamp-2, a.s-line-clamp-3, [data-cy='title-recipe'] a, h2 a", title],
    ["h2[aria-label]", null],
    ["h2 span", brand],
    ["[class*='AdHolder'], [data-component-type='sp-sponsored-result']", null],
    [".a-price .a-offscreen", price],
    [".a-price-whole", whole == null ? null : element(whole)],
    [".a-price-fraction", fraction == null ? null : element(fraction)],
    ["h2 a, a.s-no-outline, a[href*='/dp/']", title],
    ["img.s-image, img[data-image-latency]", image],
    ["[class*='Unavailable']", null],
  ]);
  return {
    getAttribute: (name) => name === "data-asin" ? "B0H6B7WYGG" : null,
    querySelector: (selector) => bySelector.get(selector) ?? null,
  };
}

const currentLayout = window.AmzinviteListing.extractCard(card());
assert.equal(currentLayout.name, "One Piece Card Game OP-16 Booster Double Pack français");
assert.equal(currentLayout.price, 11.99);
assert.equal(currentLayout.in_stock, true);
assert.equal(currentLayout.stock_status, "in_stock");

const splitPrice = window.AmzinviteListing.extractCard(card({ offscreen: null }));
assert.equal(splitPrice.price, 11.99);

const unknownAvailability = window.AmzinviteListing.extractCard(card({
  offscreen: null,
  whole: null,
  fraction: null,
}));
assert.equal(unknownAvailability.price, null);
assert.equal(unknownAvailability.in_stock, null);
assert.equal(unknownAvailability.stock_status, null);

console.log("  ✓ listing Amazon : titre, prix et statut explicite");
