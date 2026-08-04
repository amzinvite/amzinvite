import assert from "node:assert/strict";

await import("../src/popup-state.js");

const { shouldOfferAutoRequest, nextEstimatedWave, formatWaveCountdown } = globalThis.AmzinvitePopupState;

assert.equal(shouldOfferAutoRequest(), false);
assert.equal(shouldOfferAutoRequest({ manualCheckHasRun: true }), true);
assert.equal(shouldOfferAutoRequest({ manualCheckHasRun: true, autoRequest: true }), false);
assert.equal(shouldOfferAutoRequest({ manualCheckHasRun: true, autoRequestPromptHandled: true }), false);

const afterMondayWave = nextEstimatedWave(new Date("2026-08-03T20:30:00.000Z"));
assert.equal(new Date(afterMondayWave.at).toISOString(), "2026-08-07T09:30:00.000Z");
assert.equal(afterMondayWave.label, "vendredi vers 11 h 30");

const beforeMondayWave = nextEstimatedWave(new Date("2026-08-03T18:00:00.000Z"));
assert.equal(new Date(beforeMondayWave.at).toISOString(), "2026-08-03T20:00:00.000Z");
assert.equal(formatWaveCountdown(2 * 86400000 + 3 * 3600000 + 17 * 60000), "2 j 3 h 17 min");

console.log("  ✓ popup : invite auto-demande et prochaine vague estimée");
