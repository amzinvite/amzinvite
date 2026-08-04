import assert from "node:assert/strict";

await import("../src/popup-state.js");

const { shouldOfferAutoRequest, nextEstimatedWave, formatWaveCountdown } = globalThis.AmzinvitePopupState;

assert.equal(shouldOfferAutoRequest(), false);
assert.equal(shouldOfferAutoRequest({ manualCheckHasRun: true }), true);
assert.equal(shouldOfferAutoRequest({ manualCheckHasRun: true, autoRequest: true }), false);
assert.equal(shouldOfferAutoRequest({ manualCheckHasRun: true, autoRequestPromptHandled: true }), false);

const beforeFridayWave = nextEstimatedWave(new Date("2026-08-07T06:00:00.000Z"));
assert.equal(new Date(beforeFridayWave.at).toISOString(), "2026-08-07T08:00:00.000Z");
assert.equal(beforeFridayWave.label, "vendredi vers 10 h");

const afterFridayWave = nextEstimatedWave(new Date("2026-08-07T09:00:00.000Z"));
assert.equal(new Date(afterFridayWave.at).toISOString(), "2026-08-10T20:00:00.000Z");
assert.equal(afterFridayWave.label, "lundi vers 22 h");
assert.equal(formatWaveCountdown(2 * 86400000 + 3 * 3600000 + 17 * 60000), "2 j 3 h 17 min");

console.log("  ✓ popup : invite auto-demande et prochaine vague estimée");
