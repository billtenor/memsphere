import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);
const repository = resolve(import.meta.dirname, "..");
const historicalDirectory = "changes/archive/completed/20261001-project-models/assets/use-case-models";

async function jsonAssets(directory: string): Promise<Map<string, Buffer>> {
  const assets = new Map<string, Buffer>();
  async function visit(relative: string): Promise<void> {
    for (const entry of await readdir(join(repository, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".json")) assets.set(path, await readFile(join(repository, path)));
    }
  }
  await visit(directory);
  return assets;
}

async function checkoutWithAutocrlf(assets: Map<string, Buffer>, attributes: Buffer): Promise<Map<string, Buffer>> {
  const root = await mkdtemp(join(tmpdir(), "model-asset-checkout-"));
  try {
    const emptyGlobalConfig = join(root, "empty-global-config");
    await writeFile(emptyGlobalConfig, "");
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: emptyGlobalConfig, GIT_ATTR_NOSYSTEM: "1" };
    const git = (...args: string[]) => execute("git", ["-c", "core.autocrlf=true", "-c", "core.safecrlf=false", ...args], { cwd: root, env });
    await git("init", "-b", "main");
    await writeFile(join(root, ".gitattributes"), attributes);
    for (const [relative, bytes] of assets) {
      await mkdir(dirname(join(root, relative)), { recursive: true });
      await writeFile(join(root, relative), bytes);
    }
    await git("add", "--", ".gitattributes", ...assets.keys());
    // Materialize files from the index without committing or requiring a Git identity.
    for (const relative of assets.keys()) await rm(join(root, relative));
    await git("checkout-index", "--all", "--force");
    return new Map(await Promise.all([...assets.keys()].map(async relative => [relative, await readFile(join(root, relative))] as const)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("Git autocrlf checkout preserves released model JSON and approved originals byte for byte, including BOM and original line endings", async () => {
  const assets = new Map([...await jsonAssets("reserved-models"), ...await jsonAssets(historicalDirectory)]);
  assert.ok(assets.has("reserved-models/manifest.json"));
  assert.ok(assets.has(`${historicalDirectory}/01-basic-types.json`));
  const bomLf = Buffer.from('\uFEFF \n{ "type": "string" }\n');
  const bomCrlf = Buffer.from('\uFEFF \r\n{ "type": "string" }\r\n');
  for (const directory of ["reserved-models/market-models", historicalDirectory]) {
    assets.set(`${directory}/checkout-bom-lf.json`, bomLf);
    assets.set(`${directory}/checkout-bom-crlf.json`, bomCrlf);
  }
  const ordinaryText = "ordinary.txt";
  assets.set(ordinaryText, Buffer.from("ordinary\ntext\n"));
  const checkedOut = await checkoutWithAutocrlf(assets, await readFile(join(repository, ".gitattributes")));
  for (const [path, bytes] of assets) {
    if (path !== ordinaryText) assert.deepEqual(checkedOut.get(path), bytes, `checkout must preserve ${path}`);
  }
  assert.deepEqual(checkedOut.get(ordinaryText), Buffer.from("ordinary\r\ntext\r\n"), "ordinary text still follows core.autocrlf");

  // Verify this fixture reproduces the original Windows failure when the rules are absent.
  const controlPaths = ["reserved-models/market-models/checkout-bom-lf.json", `${historicalDirectory}/checkout-bom-lf.json`];
  const unprotected = await checkoutWithAutocrlf(new Map(controlPaths.map(path => [path, bomLf])), Buffer.alloc(0));
  for (const path of controlPaths) {
    assert.notDeepEqual(unprotected.get(path), bomLf, `missing attributes must expose line-ending changes in ${path}`);
    assert.deepEqual(unprotected.get(path), bomCrlf);
  }
});
