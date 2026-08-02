import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const popup = await readFile(new URL("../src/popup.html", import.meta.url), "utf8");

assert.match(popup, /id="autoRequestPrompt" hidden/);
assert.match(popup, /id="enableAutoRequest"/);
assert.match(popup, /class="prixtcg-settings-link"/);
assert.match(popup, /class="prixtcg-persistent-link"/);
assert.match(popup, /class="fixed-header"/);
assert.match(popup, /class="content-scroll"/);
assert.match(popup, /class="fixed-footer"/);
assert.match(popup, /class="mini-actions settings-links"/);
assert.doesNotMatch(popup, /class="footer-actions"/);
assert.match(popup, /class="fixed-footer">\s*<a class="prixtcg-persistent-link"/);
assert.equal(
  popup.match(/href="https:\/\/prixtcg\.fr\/pokemon\/catalogue\?source=amzinvite"/g)?.length,
  2,
  "les réglages et le bandeau persistant doivent conserver la provenance amzinvite",
);
assert.equal(
  popup.match(/src="icons\/prixtcg-logo\.svg"/g)?.length,
  2,
  "le logo PrixTCG doit être affiché dans les deux accès persistants",
);

console.log("  ✓ popup PrixTCG : invite, réglages et accès permanent présents");
