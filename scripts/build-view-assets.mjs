import { mkdir, writeFile } from "node:fs/promises";

const browserModuleUrl = new URL("../dist/view/browser.js", import.meta.url);
const outputUrl = new URL("../dist/view/legacy-view.js", import.meta.url);
const browser = await import(browserModuleUrl.href);
const bundle = browser.legacyViewBundle;

if (typeof bundle !== "string" || !bundle.trim() || !bundle.includes("export function mount(options)")) {
  throw new Error("legacy View bundle generator returned an invalid module");
}

await mkdir(new URL("../dist/view/", import.meta.url), { recursive: true });
await writeFile(outputUrl, bundle, "utf8");
