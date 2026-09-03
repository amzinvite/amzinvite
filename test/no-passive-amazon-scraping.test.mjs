import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"));
const amazonEntries = manifest.content_scripts.filter((entry) =>
  (entry.matches || []).some((pattern) => pattern.includes("amazon.")),
);
const scripts = amazonEntries.flatMap((entry) => entry.js || []);
const matches = amazonEntries.flatMap((entry) => entry.matches || []);

assert.deepEqual(scripts, ["content.js"], "seule la détection d'invitation doit rester injectée sur Amazon");
assert.ok(matches.every((pattern) => pattern.includes("/dp/*") || pattern.includes("/gp/product/*")));
assert.ok(!matches.some((pattern) => pattern.includes("/s*") || pattern.includes("/stores/page/*")));

const background = readFileSync(new URL("../src/background.js", import.meta.url), "utf8");
assert.doesNotMatch(background, /\/api\/extension\/observations/);
assert.doesNotMatch(background, /type === ["']scrape-items["']/);
assert.match(background, /type === ["']report-state["']/,
  "la détection d'état sur une fiche produit doit rester active");

console.log("  ✓ aucun scraping Amazon passif, détection d’invitation conservée");
