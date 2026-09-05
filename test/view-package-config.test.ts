import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { globalConfigSchema } from "../src/config.js";
import { projectConfigSchema } from "../src/project/model.js";
import {
  normalizeInstalledViewPackagePaths,
  stableJson,
  viewCompositionDigest
} from "../src/view/package-config.js";

test("View Package installation, theme, and composition are strict global configuration", () => {
  const packagePath = resolve("fixtures/custom-view-package");
  const global = globalConfigSchema.parse({
    view_packages: { installed: [{ path: packagePath, allow: ["styles.global"] }] },
    view_theme: { mode: "dark", selected_source: "org.example.theme" },
    view_composition: {
      packages: [{ id: "org.example.view", version: "1.0.0", enabled: true }],
      slots: { "org.memsphere.memory.page.presentation@1:page": "org.example.view:main:memory" },
      styles: { "org.example.view:main:base": true }
    }
  });
  assert.equal(global.view_packages?.installed[0]?.path, packagePath);
  assert.equal(global.view_theme?.mode, "dark");
  assert.equal(global.view_composition?.slots?.["org.memsphere.memory.page.presentation@1:page"], "org.example.view:main:memory");

  const project = projectConfigSchema.parse({
    store: { type: "managed", published_revision: "abc" },
    view: {
      packages: [{ id: "org.example.view", version: "1.0.0", enabled: true }],
      theme: { mode: "light", selected_source: "org.example.theme" },
      slots: { "org.memsphere.memory.page.presentation@1:page": "org.example.view:main:memory" },
      styles: { "org.example.view:main:base": true }
    }
  });
  assert.equal(project.view?.packages[0]?.instance_id, undefined);
  assert.equal(project.view?.theme?.selected_source, "org.example.theme");
  assert.equal(project.view?.theme?.mode, "light");
  assert.equal(project.view?.slots?.["org.memsphere.memory.page.presentation@1:page"], "org.example.view:main:memory");
  assert.equal(project.view?.styles?.["org.example.view:main:base"], true);

  assert.equal(globalConfigSchema.safeParse({ view: { packages: [] } }).success, false);
  assert.equal(globalConfigSchema.safeParse({
    view_composition: { packages: [], slots: { "org.example.unknown@1:page": null } }
  }).success, false);
  assert.equal(projectConfigSchema.safeParse({
    store: { type: "managed", published_revision: "abc" },
    view_packages: { installed: [] }
  }).success, false);
  assert.equal(projectConfigSchema.safeParse({
    store: { type: "managed", published_revision: "abc" },
    view: { packages: [], slots: { "org.example.unknown@1:page": null } }
  }).success, false);
});

test("View Package paths and composition digests are canonical", () => {
  const packagePath = resolve("fixtures/custom-view-package");
  assert.deepEqual(normalizeInstalledViewPackagePaths({
    installed: [{ path: packagePath, allow: ["styles.scoped", "styles.global"] }]
  }), {
    installed: [{ path: packagePath, allow: ["styles.global", "styles.scoped"] }]
  });

  const left = { packages: [{ enabled: true, id: "org.example.view", config: { b: 2, a: 1 } }] };
  const right = { packages: [{ config: { a: 1, b: 2 }, id: "org.example.view", enabled: true }] };
  assert.equal(stableJson(left), stableJson(right));
  assert.equal(viewCompositionDigest(left), viewCompositionDigest(right));
  assert.notEqual(viewCompositionDigest(left), viewCompositionDigest({
    packages: [{ ...left.packages[0], enabled: false }]
  }));
});

test("duplicate installed paths and global composition instance identities are rejected", () => {
  const packagePath = resolve("fixtures/custom-view-package");
  assert.equal(globalConfigSchema.safeParse({
    view_packages: { installed: [{ path: packagePath }, { path: packagePath }] }
  }).success, false);
  assert.equal(globalConfigSchema.safeParse({
    view_composition: {
      packages: [
        { id: "org.example.view", version: "1.0.0", enabled: true },
        { id: "org.example.view", version: "1.0.0", enabled: true }
      ]
    }
  }).success, false);
});
