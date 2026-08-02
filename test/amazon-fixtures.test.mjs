import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detectInvitationState } from "../src/detector.js";

const padding = "Contenu produit anonymisé. ".repeat(700);
const load = (name) => readFileSync(new URL(`fixtures/amazon/${name}`, import.meta.url), "utf8")
  .replace("{{PADDING}}", padding);

const matrix = [
  ["available.html", "available"],
  ["already-requested.html", "already_requested"],
  ["accepted.html", "accepted"],
  ["expired-requestable.html", "available"],
  ["expired-not-requestable.html", "already_requested"],
  ["consumed.html", "already_requested"],
  ["normal-product.html", "not_invitation"],
  ["captcha.html", "not_invitation"],
];

for (const [file, expected] of matrix) {
  assert.equal(detectInvitationState("", null, load(file)), expected, file);
}

assert.ok(load("stub.html").length < 15_000, "la fixture stub doit rester sous le seuil du background");
console.log(`  ✓ matrice Amazon : ${matrix.length} états + stub`);
