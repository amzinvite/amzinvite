import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const files = readdirSync(new URL("../test/", import.meta.url))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort();

for (const file of files) {
  const result = spawnSync(process.execPath, [`test/${file}`], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`\n✓ ${files.length} fichiers de tests réussis`);
