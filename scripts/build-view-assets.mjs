import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const { validateModuleStyleBoundary, validateShellThemeStyles } = await import(new URL("../src/view/style-contract.ts", import.meta.url).href);
const [{ builtinModuleCatalog }, { parseModuleManifest, resolveModuleViewEntry }, { viewShellStyles }, { viewUiStyles }] = await Promise.all([
  import(new URL("../src/module/builtin-catalog.ts", import.meta.url).href),
  import(new URL("../src/module/manifest.ts", import.meta.url).href),
  import(new URL("../src/view/shell/layout.ts", import.meta.url).href),
  import(new URL("../src/view/ui-primitives.ts", import.meta.url).href)
]);

validateShellThemeStyles(viewShellStyles);
validateShellThemeStyles(viewUiStyles, "View UI Primitives");

for (const catalogEntry of builtinModuleCatalog) {
  const sourceRoot = resolve(repositoryRoot, "modules", catalogEntry.packageDirectory);
  const manifestPath = resolve(sourceRoot, "module.json");
  const manifest = parseModuleManifest(JSON.parse(await readFile(manifestPath, "utf8")));
  if (manifest.id !== catalogEntry.moduleId) {
    throw new Error(`Builtin catalog id does not match Manifest: ${catalogEntry.moduleId}`);
  }

  const outputRoot = resolve(repositoryRoot, "dist", "modules", catalogEntry.packageDirectory);
  const outputEntry = resolveModuleViewEntry(outputRoot, manifest);
  const sourceEntry = resolve(sourceRoot, "adapter", "view", "index.ts");
  validateModuleStyleBoundary(await readFile(sourceEntry, "utf8"), catalogEntry.moduleId);
  await mkdir(dirname(outputEntry), { recursive: true });
  await build({
    entryPoints: [sourceEntry],
    outfile: outputEntry,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external: ["@memsphere/view-sdk"],
    logLevel: "silent"
  });
  await copyFile(manifestPath, resolve(outputRoot, "module.json"));
}
