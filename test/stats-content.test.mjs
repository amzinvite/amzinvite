import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"));
const statsScript = readFileSync(new URL("../src/stats-content.js", import.meta.url), "utf8");
const statsEntry = manifest.content_scripts.find((entry) => entry.js?.includes("stats-content.js"));

assert.deepEqual(statsEntry?.matches, ["https://prixtcg.fr/amzinvite/stats*"]);
assert.match(statsScript, /chrome\.storage\.local\.get\(\["knownStates", "knownExpiry"\]\)/);
assert.match(statsScript, /knownStates\?\.\[key\] !== "accepted"/);
assert.match(statsScript, /Vous avez été sélectionné !/);
assert.match(statsScript, /Commander maintenant sur Amazon/);
assert.match(statsScript, /data-amzinvite-expiry/);

console.log("  ✓ stats PrixTCG : sélections locales et compte à rebours injectés");
