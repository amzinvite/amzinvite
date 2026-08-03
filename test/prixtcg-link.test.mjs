import assert from "node:assert/strict";

await import("../src/prixtcg.js");

const links = globalThis.AmzinvitePrixTcg;
assert.ok(links, "les helpers PrixTCG doivent être exposés");
assert.equal(
  links.productComparisonUrl("https://www.amazon.fr/Pokemon/dp/b0abcdef12?th=1"),
  "https://prixtcg.fr/r/amzinvite/B0ABCDEF12?source=amzinvite&utm_source=amzinvite&utm_medium=extension&utm_campaign=product",
);
assert.equal(
  links.productComparisonUrl("https://www.amazon.com/dp/B0ABCDEF12"),
  null,
);
assert.equal(
  links.productComparisonUrl("https://example.com/dp/B0ABCDEF12"),
  null,
);
assert.equal(
  links.catalogueUrl(),
  "https://prixtcg.fr/pokemon/catalogue?source=amzinvite&utm_source=amzinvite&utm_medium=extension&utm_campaign=catalogue",
);

console.log("  ✓ liens PrixTCG : ASIN exact et attribution GA4 amzinvite");
