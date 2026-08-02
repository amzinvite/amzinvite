import { readFileSync } from "node:fs";

const extensionId = "omnadclklfdghknlhgfilpinklhgophe";
const manifest = JSON.parse(
  readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"),
);
const query = new URLSearchParams({
  response: "updatecheck",
  prodversion: "140.0.0.0",
  acceptformat: "crx2,crx3",
  x: `id=${extensionId}&uc`,
});
const response = await fetch(
  `https://clients2.google.com/service/update2/crx?${query}`,
  { headers: { "Cache-Control": "no-cache" } },
);
if (!response.ok) {
  throw new Error(`Chrome update service HTTP ${response.status}`);
}
const xml = await response.text();
const version = xml.match(/<updatecheck\b[^>]*\bversion="([^"]+)"/i)?.[1];
if (!version) {
  throw new Error("Version publique introuvable dans la réponse Chrome");
}

console.log(`Manifest local : ${manifest.version}`);
console.log(`Chrome Web Store : ${version}`);
if (version !== manifest.version) {
  console.error("La version courante n'est pas encore distribuée par Google.");
  process.exitCode = 2;
} else {
  console.log("✓ La version du manifest est distribuée par Google");
}
