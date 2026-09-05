import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const root = resolve("examples/view-packages/custom-view-showcase");
const outputPath = resolve(root, "index.js");

export async function buildExampleViewPackage() {
  const result = await build({
    entryPoints: [resolve(root, "src/index.js")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["@memsphere/view-sdk"],
    legalComments: "none",
    write: false,
    logLevel: "silent"
  });
  const output = result.outputFiles[0]?.text;
  if (!output) throw new Error("Example View Package build produced no JavaScript");
  return output;
}

export async function checkExampleViewPackage() {
  const output = await buildExampleViewPackage();
  const committed = await readFile(outputPath, "utf8");
  if (committed !== output) {
    throw new Error("Example View Package bundle is stale; run node scripts/build-example-view-package.mjs");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--check")) await checkExampleViewPackage();
  else await writeFile(outputPath, await buildExampleViewPackage());
}
