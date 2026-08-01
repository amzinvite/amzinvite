import assert from "node:assert/strict";

await import("../src/popup-state.js");

const { shouldOfferAutoRequest } = globalThis.AmzinvitePopupState;

assert.equal(shouldOfferAutoRequest(), false);
assert.equal(shouldOfferAutoRequest({ manualCheckHasRun: true }), true);
assert.equal(shouldOfferAutoRequest({ manualCheckHasRun: true, autoRequest: true }), false);
assert.equal(shouldOfferAutoRequest({ manualCheckHasRun: true, autoRequestPromptHandled: true }), false);

console.log("  ✓ invite auto-demande : affichée une seule fois après le premier check");
