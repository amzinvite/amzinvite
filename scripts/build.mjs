import { basename } from "node:path";
import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { transformSync } from "esbuild";

const root = new URL("../", import.meta.url);
const source = new URL("../src/", import.meta.url);
const destination = new URL("../dist/", import.meta.url);

rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, {
  recursive: true,
  filter: (entry) => basename(entry) !== ".DS_Store",
});

function minifyJavaScript(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const url = new URL(entry.name, directory);
    if (entry.isDirectory()) {
      minifyJavaScript(new URL(`${entry.name}/`, directory));
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    const sourceCode = readFileSync(url, "utf8");
    const result = transformSync(sourceCode, {
      loader: "js",
      minify: true,
      legalComments: "none",
      target: "es2022",
      sourcefile: entry.name,
    });
    writeFileSync(url, result.code);
  }
}

minifyJavaScript(destination);
console.log("✓ Extension construite et minifiée dans dist/");
