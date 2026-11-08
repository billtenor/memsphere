import assert from "node:assert/strict";
import test from "node:test";
import { currentMemorySyntax } from "../src/memory/syntax.js";
import { reservedMemoryManifestSchema, reservedSystemMemoryRemovalTombstones, systemMemoryRemovalDigest } from "../src/reserved/store.js";

test("manifest rejects unsafe, duplicate, overlapping, and unknown values", () => {
  for (const manifest of [
    { version: 1, system_memory: { install: ["../concepts/x.yaml"], remove: [] } },
    { version: 1, system_memory: { install: ["concepts/./x.yaml"], remove: [] } },
    { version: 1, system_memory: { install: ["concepts/x.yaml", "concepts/x.yaml"], remove: [] } },
    { version: 1, system_memory: { install: ["concepts/x.yaml"], remove: ["concepts/x.yaml"] } },
    { version: 1, system_memory: { install: [], remove: [] }, extra: true },
    {
      version: 3,
      memory_syntax: currentMemorySyntax,
      system_memory: {
        install: [],
        remove: [{ path: "concepts/x.yaml", references: ["statements/x"] }]
      }
    },
    {
      version: 3,
      memory_syntax: currentMemorySyntax,
      system_memory: {
        install: [],
        remove: [
          { path: "concepts/x.yaml", references: ["concepts/x"] },
          { path: "concepts/x.yaml", references: ["concepts/x-old"] }
        ]
      }
    },
    {
      version: 3,
      memory_syntax: currentMemorySyntax,
      system_memory: {
        install: [],
        remove: [{ path: "concepts/x.yaml", references: ["concepts/x", "concepts/x"] }]
      }
    },
    {
      version: 3,
      memory_syntax: currentMemorySyntax,
      system_memory: {
        install: [],
        remove: [{ path: "concepts/x.yaml", references: ["concepts/legacy\tname"] }]
      }
    },
    {
      version: 3,
      memory_syntax: currentMemorySyntax,
      system_memory: {
        install: [],
        remove: [{ path: "concepts/x.yaml", references: ["concepts/legacy\nname"] }]
      }
    },
    {
      version: 3,
      memory_syntax: currentMemorySyntax,
      system_memory: {
        install: [],
        remove: [{ path: "concepts/x.yaml", references: ["concepts/legacy\u007fname"] }]
      }
    }
  ]) {
    assert.equal(reservedMemoryManifestSchema.safeParse(manifest).success, false);
  }
});


test("legacy manifests remain readable but cannot authorize identity-based removal", () => {
  for (const version of [1, 2] as const) {
    const parsed = reservedMemoryManifestSchema.parse({
      version,
      ...(version === 2 ? { memory_syntax: currentMemorySyntax } : {}),
      system_memory: { install: [], remove: ["concepts/legacy.yaml"] }
    });
    assert.deepEqual(reservedSystemMemoryRemovalTombstones(parsed), []);
  }
});


test("manifest v5 removal matches bind identity to an issued content digest", () => {
  const match = { reference: "procedures/legacy", sha256: "a".repeat(64) };
  const base = {
    version: 5, memory_syntax: currentMemorySyntax,
    system_memory: { install: [], remove: [{ path: "procedures/legacy.yaml", matches: [match] }] },
    market_memory: { install: [] }
  };
  assert.equal(reservedMemoryManifestSchema.parse(base).version, 5);
  assert.equal(reservedSystemMemoryRemovalTombstones(reservedMemoryManifestSchema.parse(base))[0]!.matches[0]!.sha256, match.sha256);
  assert.equal(reservedMemoryManifestSchema.safeParse({ ...base, system_memory: { install: [], remove: [{ path: "procedures/legacy.yaml", matches: [match, match] }] } }).success, false);
  assert.equal(reservedMemoryManifestSchema.safeParse({ ...base, system_memory: { install: [], remove: [{ path: "procedures/legacy.yaml", matches: [{ ...match, sha256: "bad" }] }] } }).success, false);
});


test("removal digest normalizes CRLF without changing other bytes", () => {
  assert.equal(systemMemoryRemovalDigest(Buffer.from("a\r\nb\n")), systemMemoryRemovalDigest(Buffer.from("a\nb\n")));
  assert.notEqual(systemMemoryRemovalDigest(Buffer.from([0xff])), systemMemoryRemovalDigest(Buffer.from("\ufffd")));
  assert.throws(() => systemMemoryRemovalDigest(Buffer.from("a\rb")), /lone CR/);
});
