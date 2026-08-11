import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const popup = await readFile(new URL("../src/popup.html", import.meta.url), "utf8");
const popupJs = await readFile(new URL("../src/popup.js", import.meta.url), "utf8");

assert.match(popup, /id="autoRequestPrompt" hidden/);
assert.match(popup, /id="enableAutoRequest"/);
assert.match(popup, /id="product-search"/);
assert.match(popup, /id="alerts-toggle"/);
assert.match(popup, /id="alerts-list"/);
assert.match(popupJs, /matchesProductSearch/);
assert.match(popupJs, /renderLocalAlerts/);
assert.match(popupJs, /class="alert-entry-icon"/);
assert.match(popupJs, /class="alert-entry-content"/);
assert.match(popup, /\.alert-entry-content \{ display: flex; min-width: 0; flex-direction: column; gap: 3px; \}/);
assert.match(popup, /class="prixtcg-settings-link"/);
assert.match(popup, /class="prixtcg-persistent-link"/);
assert.match(popup, /class="fixed-header"/);
assert.match(popup, /class="content-scroll"/);
assert.match(popup, /class="fixed-footer"/);
assert.match(popup, /class="mini-actions settings-links"/);
assert.doesNotMatch(popup, /class="footer-actions"/);
assert.doesNotMatch(popup, /id="intervalMin"/, "l'intervalle manuel doit disparaître des réglages");
assert.match(popup, /Surveillance intelligente/);
assert.match(popup, /class="fixed-footer">\s*<a class="prixtcg-persistent-link"/);
assert.equal(
  popup.match(/href="https:\/\/prixtcg\.fr\/pokemon\/catalogue\?source=amzinvite&amp;utm_source=amzinvite&amp;utm_medium=extension&amp;utm_campaign=popup"/g)?.length,
  2,
  "les réglages et le bandeau persistant doivent attribuer le trafic à l'extension amzinvite",
);

assert.match(
  popup,
  /href="https:\/\/prixtcg\.fr\/amzinvite\/stats\?source=amzinvite&amp;utm_source=amzinvite&amp;utm_medium=extension&amp;utm_campaign=wave_countdown"/,
  "le compte à rebours doit ouvrir les statistiques publiques de la dernière vague",
);
assert.equal(
  popup.match(/src="icons\/prixtcg-logo\.svg"/g)?.length,
  2,
  "le logo PrixTCG doit être affiché dans les deux accès persistants",
);

console.log("  ✓ popup PrixTCG : invite, réglages et accès permanent présents");
