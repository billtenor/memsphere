import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  compareViewCandidatePriority,
  OFFICIAL_VIEW_CANDIDATE_PRIORITY,
  resolveViewPackageComposition,
  ViewPackageAssetRegistry
} from "../src/module/package-registry.js";

test("View Package resolver loads installed versions and blocks unresolved same-priority cells", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-view-packages-"));
  try {
    const first = await makePackage(root, "first", "org.example.first", "first");
    const second = await makePackage(root, "second", "org.example.second", "second");
    const global = { installed: [{ path: first }, { path: second }] };
    const baseProject = {
      packages: [
        { id: "org.example.first", version: "1.0.0", enabled: true },
        { id: "org.example.second", version: "1.0.0", enabled: true }
      ]
    };
    const conflicted = await resolveViewPackageComposition({ global, composition: baseProject, sdkVersion: "1.0.0" });
    assert.equal(conflicted.installed.length, 2);
    assert.deepEqual(conflicted.instances.map(value => value.contributionPolicy.blockedCells), [
      ["org.memsphere.memory.page.presentation@1:page"],
      ["org.memsphere.memory.page.presentation@1:page"]
    ]);

    const preferredIdentity = "org.example.second:org.example.second:second";
    const resolved = await resolveViewPackageComposition({
      global,
      composition: {
        packages: baseProject.packages.map(entry => ({
          ...entry,
          preferences: { "org.memsphere.memory.page.presentation@1:page": preferredIdentity }
        }))
      },
      sdkVersion: "1.0.0"
    });
    assert.deepEqual(resolved.instances.map(value => value.contributionPolicy.blockedCells), [[], []]);
    assert.deepEqual(
      resolved.instances[1]?.contributionPolicy.registrations.find(entry => entry.id === "second")?.priority,
      [100, 0]
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("global style capability requires the installed Package grant", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-view-grants-"));
  try {
    const packageRoot = await makePackage(root, "styled", "org.example.styled", "styled", true);
    for (const manifest of [false, true]) {
      for (const home of [false, true]) {
        const source = JSON.parse(await import("node:fs/promises").then(fs => fs.readFile(join(packageRoot, "module.json"), "utf8")));
        source.view.capabilities = manifest ? ["styles.global"] : [];
        source.view.styles = manifest ? [{ id: "global", file: "./global.css", scope: "global" }] : [];
        await writeFile(join(packageRoot, "module.json"), JSON.stringify(source));
        const composition = await resolveViewPackageComposition({
          global: { installed: [{ path: packageRoot, ...(home ? { allow: ["styles.global" as const] } : {}) }] },
          composition: { packages: [{ id: "org.example.styled", version: "1.0.0", enabled: true }] },
          sdkVersion: "1.0.0"
        });
        const allowed = composition.instances[0]?.allow.has("styles.global") ?? false;
        assert.equal(allowed, manifest && home, `${manifest}/${home}`);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("global composition can select Package contributions and global styles through Slots", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-view-selection-"));
  try {
    const first = await makePackage(root, "first", "org.example.first", "first", true);
    const second = await makePackage(root, "second", "org.example.second", "second", true);
    for (const [packageRoot, id] of [[first, "first"], [second, "second"]] as const) {
      const manifest = JSON.parse(await import("node:fs/promises").then(fs => fs.readFile(join(packageRoot, "module.json"), "utf8")));
      manifest.view.contributions.push({ id: `nav-${id}`, cell: `navigation.primary@1:nav-${id}`, priority: 100 });
      await writeFile(join(packageRoot, "module.json"), JSON.stringify(manifest));
    }
    const cell = "org.memsphere.memory.page.presentation@1:page";
    const composition = await resolveViewPackageComposition({
      global: { installed: [{ path: first, allow: ["styles.global"] }, { path: second, allow: ["styles.global"] }] },
      composition: {
        packages: [
          { id: "org.example.first", version: "1.0.0", enabled: true, allow: ["styles.global"] },
          { id: "org.example.second", version: "1.0.0", enabled: true, allow: ["styles.global"] }
        ],
        slots: {
          [cell]: "org.example.second:org.example.second:second",
          "styles.global@1": ["org.example.second:org.example.second:global"]
        }
      },
      sdkVersion: "1.0.0"
    });
    assert.deepEqual(composition.instances.map(instance => instance.contributionPolicy.blockedCells), [[], []]);
    assert.deepEqual(composition.instances[1]!.contributionPolicy.registrations[0]!.priority, [100, 0]);
    assert.deepEqual(composition.instances[0]!.contributionPolicy.registrations[0]!.priority, [1001, 0]);
    assert.equal(composition.instances[1]!.contributionPolicy.registrations[0]!.enabled, true);
    assert.equal(composition.instances[0]!.contributionPolicy.registrations[0]!.enabled, false);
    assert.deepEqual([...composition.instances[0]!.allowedStyleIds], []);
    assert.deepEqual([...composition.instances[1]!.allowedStyleIds], ["global"]);
    const listComposition = await resolveViewPackageComposition({
      global: { installed: [{ path: first }, { path: second }] },
      composition: {
        packages: [
          { id: "org.example.first", version: "1.0.0", enabled: true },
          { id: "org.example.second", version: "1.0.0", enabled: true }
        ],
        slots: { "navigation.primary@1": ["org.example.first:org.example.first:nav-first"] }
      },
      sdkVersion: "1.0.0"
    });
    assert.equal(listComposition.instances[0]!.contributionPolicy.registrations.find(entry => entry.id === "nav-first")?.enabled, true);
    assert.equal(listComposition.instances[1]!.contributionPolicy.registrations.find(entry => entry.id === "nav-second")?.enabled, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("asset registry isolates Projects, rejects unsafe types and invalidates changed bytes", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-view-assets-"));
  try {
    await writeFile(join(root, "entry.js"), "export default 1;\n");
    await writeFile(join(root, "unsafe.svg"), "<svg/>");
    const registry = new ViewPackageAssetRegistry(Buffer.alloc(32, 7));
    const asset = await registry.register({ projectId: "a", instanceId: "view", packageRoot: root, file: "./entry.js" });
    assert.equal((await registry.read(asset.key, "a"))?.body.toString(), "export default 1;\n");
    assert.equal(await registry.read(asset.key, "b"), undefined);
    await writeFile(join(root, "entry.js"), "export default 2;\n");
    assert.equal(await registry.read(asset.key, "a"), undefined);
    await assert.rejects(
      registry.register({ projectId: "a", instanceId: "view", packageRoot: root, file: "./unsafe.svg" }),
      /not allowed/
    );
    const outside = join(root, "..", `outside-${Date.now()}.js`);
    await writeFile(outside, "export default 3;\n");
    await symlink(outside, join(root, "escape.js"));
    await assert.rejects(
      registry.register({ projectId: "a", instanceId: "view", packageRoot: root, file: "./escape.js" }),
      /escapes/
    );
    await rm(outside, { force: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("candidate comparison uses integer tuples and the official fallback stays at 1000", () => {
  assert.equal(OFFICIAL_VIEW_CANDIDATE_PRIORITY, 1000);
  assert.ok(compareViewCandidatePriority([999, 99], [1000, 0]) < 0);
  assert.ok(compareViewCandidatePriority([100, 0], [100, 1]) < 0);
});

async function makePackage(
  parent: string,
  directory: string,
  id: string,
  contributionId: string,
  withStyle = false,
): Promise<string> {
  const root = join(parent, directory);
  await mkdir(root);
  await writeFile(join(root, "entry.js"), "export default {};\n");
  if (withStyle) await writeFile(join(root, "global.css"), ".org-example { color: red; }\n");
  await writeFile(join(root, "module.json"), JSON.stringify({
    schemaVersion: 1,
    id,
    version: "1.0.0",
    view: {
      entry: "./entry.js",
      sdk: "^1.0.0",
      contributions: [{
        id: contributionId,
        cell: "org.memsphere.memory.page.presentation@1:page",
        priority: 100
      }],
      ...(withStyle ? { capabilities: ["styles.global"], styles: [{ id: "global", file: "./global.css", scope: "global" }] } : {})
    }
  }));
  return root;
}
