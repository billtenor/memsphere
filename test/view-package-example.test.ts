import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { resolveViewPackageComposition } from "../src/module/package-registry.js";
import { checkExampleViewPackage } from "../scripts/build-example-view-package.mjs";

test("example View Package bundle is reproducible, SDK-external, and copy-installable", async () => {
  await checkExampleViewPackage();
  const sourceRoot = resolve("examples/view-packages/dsh-custom-view");
  const [source, bundle] = await Promise.all([
    readFile(join(sourceRoot, "src/index.js"), "utf8"),
    readFile(join(sourceRoot, "index.js"), "utf8")
  ]);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.match(source, /presentation\.memoryPage/);
  assert.match(bundle, /from "@memsphere\/view-sdk"/);
  assert.doesNotMatch(bundle, /memsphere\.view\.slot-token|slotTokenBrand/);

  const temporary = await mkdtemp(join(tmpdir(), "memsphere-example-package-"));
  const copied = join(temporary, "custom-view");
  try {
    await cp(sourceRoot, copied, { recursive: true });
    const composition = await resolveViewPackageComposition({
      global: { installed: [{ path: copied }] },
      project: {
        packages: [{ id: "org.example.memsphere.custom-view", version: "1.0.0", enabled: true }]
      },
      sdkVersion: "1.0.0"
    });
    assert.equal(composition.installed[0]?.root, copied);
    assert.equal(composition.instances.length, 1);
    const globalThemeOnly = await resolveViewPackageComposition({
      global: { installed: [{ path: copied, allow: ["theme.override"] }] },
      globalThemeSource: "org.example.memsphere.custom-view:sea-glass",
      project: { packages: [] },
      sdkVersion: "1.0.0"
    });
    assert.equal(globalThemeOnly.instances.length, 1);
    assert.equal(globalThemeOnly.instances[0]?.allow.has("theme.override"), true);
    assert.equal(globalThemeOnly.instances[0]?.allowedStyleIds.size, 0);
    assert.equal(globalThemeOnly.instances[0]?.contributionPolicy.registrations.every(entry => entry.enabled === false), true);
    const globalThemeWithProjectContent = await resolveViewPackageComposition({
      global: { installed: [{ path: copied, allow: ["theme.override"] }] },
      globalThemeSource: "org.example.memsphere.custom-view:sea-glass",
      project: { packages: [{ id: "org.example.memsphere.custom-view", version: "1.0.0", enabled: true, allow: [] }] },
      sdkVersion: "1.0.0"
    });
    assert.equal(globalThemeWithProjectContent.instances[0]?.allow.has("theme.override"), true);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
