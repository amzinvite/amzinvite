import assert from "node:assert/strict";

import { extractProductStockFromHtml } from "../src/product-observation.js";

assert.deepEqual(
  extractProductStockFromHtml(`
    <div id="availability">Temporairement en rupture de stock.</div>
    <span class="a-offscreen">19,99 €</span>
  `, { price: 19.99 }),
  { stock_status: "out_of_stock", in_stock: false },
  "la rupture prime sur un prix résiduel",
);

assert.deepEqual(
  extractProductStockFromHtml(`
    <div id="desktop_buybox">
      <div id="availability">En stock</div>
      <input id="add-to-cart-button" type="submit">
    </div>
  `, { price: 11.99 }),
  { stock_status: "in_stock", in_stock: true },
);

assert.deepEqual(
  extractProductStockFromHtml(`
    <div id="availability">Disponible en précommande.</div>
  `),
  { stock_status: "preorder", in_stock: true },
);

assert.deepEqual(
  extractProductStockFromHtml(`
    <div id="desktop_buybox">Demander une invitation</div>
  `),
  { stock_status: "invitation", in_stock: false },
);

console.log("  ✓ observations produit : stock, rupture, précommande et invitation");
