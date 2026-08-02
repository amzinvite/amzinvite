const OUT_OF_STOCK_RE = /temporairement\s*en\s*rupture|actuellement\s*indisponible|indisponible|en\s*rupture|out\s*of\s*stock/i;
const PREORDER_RE = /en\s*pr[ée]commande|précommande|pre-?order|disponible\s*le|sortie\s*pr[ée]vue/i;
const IN_STOCK_RE = /en\s*stock|disponible|expédié|in\s*stock/i;
const INVITATION_RE = /disponible\s*sur\s*invitation|demander\s*une\s*invitation|request\s*an\s*invitation/i;

function visibleText(rawHtml) {
  return String(rawHtml || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&eacute;|&#233;/gi, "é")
    .replace(/&egrave;|&#232;/gi, "è")
    .replace(/&ecirc;|&#234;/gi, "ê")
    .replace(/\s+/g, " ")
    .trim();
}

function buyboxSlice(html) {
  const source = String(html || "");
  const anchors = [
    'id="availability"',
    'id="desktop_buybox"',
    'id="buybox"',
    'id="qualifiedBuybox"',
  ];
  const positions = anchors
    .map((anchor) => source.indexOf(anchor))
    .filter((position) => position >= 0);
  if (!positions.length) return source.slice(0, 250_000);
  const start = Math.min(...positions);
  return source.slice(start, start + 80_000);
}

export function extractProductStockFromHtml(html, { price = null } = {}) {
  if (!html) return { stock_status: null, in_stock: null };
  const scopedHtml = buyboxSlice(html);
  const text = visibleText(scopedHtml);

  if (INVITATION_RE.test(text)) {
    return { stock_status: "invitation", in_stock: false };
  }
  if (OUT_OF_STOCK_RE.test(text)) {
    return { stock_status: "out_of_stock", in_stock: false };
  }
  if (PREORDER_RE.test(text)) {
    return { stock_status: "preorder", in_stock: true };
  }
  const buyButtons = scopedHtml.match(/<(?:input|button)\b[^>]*id=["'](?:add-to-cart-button|buy-now-button)["'][^>]*>/gi) || [];
  const hasActiveBuyButton = buyButtons.some((tag) => !/\bdisabled\b/i.test(tag));
  if (hasActiveBuyButton || IN_STOCK_RE.test(text) || price != null) {
    return { stock_status: "in_stock", in_stock: true };
  }
  return { stock_status: null, in_stock: null };
}
