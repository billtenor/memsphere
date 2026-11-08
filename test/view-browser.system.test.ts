import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { createViewServer } from "../src/commands/view.js";
import type { MemsphereConfig } from "../src/config.js";
import { withCurrentMemorySyntax } from "./helpers/memory.js";

test("Memory summary API lists valid headers even when the body cannot be parsed", async t => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-summary-api-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const memoryRoot = join(root, "memory");
  await mkdir(join(memoryRoot, "concepts"), { recursive: true });
  await writeFile(join(memoryRoot, "concepts/broken.yaml"), withCurrentMemorySyntax(
    "!concept\nnames: [valid-name, Valid name]\ndefines: [\n"
  ));
  const config: MemsphereConfig = {
    configPath: join(root, "config.json"), scopeRoot: root, homeRoot: root,
    language: "en", memoryRoot, runsRoot: join(root, "runs"), archiveRoot: join(root, "archives"),
    debug: { agentReview: false, root: join(root, ".runtime") }, view: { host: "127.0.0.1", port: 0 }
  };
  const server = createViewServer(config);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const summaryResponse = await fetch(`${origin}/api/memories?representation=summary`);
  assert.equal(summaryResponse.status, 200);
  const summary = (await summaryResponse.json()).memories;
  assert.equal(summary.length, 1);
  assert.equal(summary[0].id, "concepts/valid-name");
  assert.deepEqual(summary[0].names, ["valid-name", "Valid name"]);
  assert.equal(summary[0].error, undefined);
  assert.equal(summary[0].entity, undefined);

  const fullResponse = await fetch(`${origin}/api/memories`);
  assert.equal(fullResponse.status, 200);
  const full = (await fullResponse.json()).memories;
  assert.equal(full.length, 1);
  assert.equal(full[0].path, "concepts/broken.yaml");
  assert.ok(full[0].error);
});


test("Memory API identifies installed system memory independently of its file path", async t => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-system-memory-api-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const memoryRoot = join(root, "memory");
  await mkdir(join(memoryRoot, "concepts"), { recursive: true });
  await writeFile(join(memoryRoot, "concepts/memory-8aaf6c34fc49.yaml"), withCurrentMemorySyntax(
    "!concept\nnames: [memsphere-memory, Memory]\ndefines: [System fixture]\n"
  ));
  await writeFile(join(memoryRoot, "concepts/user-note.yaml"), withCurrentMemorySyntax(
    "!concept\nnames: [user-note]\ndefines: [User fixture]\n"
  ));
  const config: MemsphereConfig = {
    configPath: join(root, "config.json"), scopeRoot: root, homeRoot: root,
    language: "en", memoryRoot, runsRoot: join(root, "runs"), archiveRoot: join(root, "archives"),
    debug: { agentReview: false, root: join(root, ".runtime") }, view: { host: "127.0.0.1", port: 0 }
  };
  const server = createViewServer(config);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const response = await fetch(`${url}/api/memories`);
  const payload = await response.json() as {
    memories: Array<{ path: string; system: boolean; entity?: { names?: string[] } }>;
    systemMemoryPaths?: unknown;
  };
  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn(payload, "systemMemoryPaths"), false);
  const systemMemory = payload.memories.find(memory => memory.entity?.names?.[0] === "memsphere-memory");
  assert.equal(systemMemory?.path, "concepts/memory-8aaf6c34fc49.yaml");
  assert.equal(systemMemory?.system, true);
  const userMemory = payload.memories.find(memory => memory.entity?.names?.[0] === "user-note");
  assert.equal(userMemory?.system, false);
});
