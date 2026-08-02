(function exposePrixTcgLinks(global) {
  const PRIXTCG_BASE = "https://prixtcg.fr";
  const SOURCE = "amzinvite";

  function asinFromAmazonUrl(rawUrl) {
    try {
      const url = new URL(rawUrl);
      const host = url.hostname.toLowerCase();
      const supported = host === "amazon.fr" || host.endsWith(".amazon.fr");
      if (!supported) return null;
      const match = url.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i);
      return match ? match[1].toUpperCase() : null;
    } catch {
      return null;
    }
  }

  function productComparisonUrl(amazonUrl) {
    const asin = asinFromAmazonUrl(amazonUrl);
    if (!asin) return null;
    const url = new URL(`/r/amzinvite/${encodeURIComponent(asin)}`, PRIXTCG_BASE);
    url.searchParams.set("source", SOURCE);
    return url.toString();
  }

  function catalogueUrl() {
    const url = new URL("/pokemon/catalogue", PRIXTCG_BASE);
    url.searchParams.set("source", SOURCE);
    return url.toString();
  }

  global.AmzinvitePrixTcg = {
    asinFromAmazonUrl,
    catalogueUrl,
    productComparisonUrl,
  };
})(globalThis);
