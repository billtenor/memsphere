import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { resolveMemsphereHome } from "../src/home.js";

test("resolves platform-native Memsphere Home paths", () => {
  assert.equal(resolveMemsphereHome({ platform: "linux", userHome: "/test-home", env: {} }), resolve("/test-home/.local/share/memsphere"));
  assert.equal(resolveMemsphereHome({ platform: "linux", userHome: "/test-home", env: { XDG_DATA_HOME: "/test-data" } }), resolve("/test-data/memsphere"));
  assert.equal(resolveMemsphereHome({ platform: "darwin", userHome: "/test-home", env: {} }), resolve("/test-home/Library/Application Support/memsphere"));
  assert.equal(resolveMemsphereHome({ platform: "win32", userHome: "C:\\test-home", env: { LOCALAPPDATA: "C:\\test-data" } }), resolve("C:\\test-data/memsphere"));
});

test("MEMSPHERE_HOME overrides every platform", () => {
  assert.equal(resolveMemsphereHome({ platform: "win32", env: { MEMSPHERE_HOME: "/portable/memory" } }), resolve("/portable/memory"));
});

test("Windows requires LOCALAPPDATA without an override", () => {
  assert.throws(() => resolveMemsphereHome({ platform: "win32", env: {} }), /LOCALAPPDATA/);
});
