import { readFileSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = new URL("../", import.meta.url);
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
};

console.log("1/5 Syntaxe JavaScript");
for (const dir of ["src", "test", "scripts"]) {
  for (const file of readdirSync(new URL(`../${dir}/`, import.meta.url))) {
    if (file.endsWith(".js") || file.endsWith(".mjs")) run(process.execPath, ["--check", `${dir}/${file}`]);
  }
}

console.log("2/5 Analyse statique");
run(process.execPath, ["node_modules/eslint/bin/eslint.js", "src", "test", "scripts"]);

console.log("3/5 Manifest");
const manifest = JSON.parse(readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("manifest_version doit valoir 3");
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("version du manifest invalide");
for (const required of ["background.js", "detector.js", "content.js", "popup.js"]) {
  readFileSync(new URL(`../src/${required}`, import.meta.url));
}

console.log("4/5 Tests automatisés");
run(process.execPath, ["scripts/run-tests.mjs"]);

console.log("5/5 Confidentialité des fixtures");
const fixtureDir = new URL("../test/fixtures/amazon/", import.meta.url);
const forbidden = [/@[a-z0-9.-]+\.[a-z]{2,}/i, /session-id/i, /at-acb/i, /sess-at/i, /x-amz-access-token/i];
for (const file of readdirSync(fixtureDir).filter((name) => name.endsWith(".html"))) {
  const html = readFileSync(new URL(file, fixtureDir), "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(html)) throw new Error(`fixture potentiellement sensible : ${file} (${pattern})`);
  }
}

if (process.argv.includes("--pack")) {
  run(process.execPath, ["scripts/build.mjs"]);
  const dist = new URL("../dist/", import.meta.url);
  const archive = new URL(`amzinvite-v${manifest.version}.zip`, dist);
  rmSync(archive, { force: true });
  run("zip", ["-qr", archive.pathname, ".", "-x", ".DS_Store", "*/.DS_Store", "*.zip"], dist);
  console.log(`\n✓ Archive créée : dist/amzinvite-v${manifest.version}.zip`);
} else {
  console.log("\n✓ Contrôle de release réussi (utilise npm run release:pack pour créer le ZIP)");
}
