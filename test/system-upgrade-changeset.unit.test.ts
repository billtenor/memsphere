import * as changes from "../src/memory/changeset.js";
import assert from "node:assert/strict";
import test from "node:test";
import { currentMemorySyntax } from "../src/memory/syntax.js";


const reference = "concepts/shared";

const path = "concepts/shared.yaml";

const baseline = `!concept\nsyntax: ${currentMemorySyntax}\nnames: [shared]\ndefines: [Published]\n`;

const content = baseline.replace("Published", "Upgraded");

const targets: changes.SystemUpgradeMemoryTarget[] = [{ reference, path, operation: "update", content }];


test("Dedicated intent and metadata must be paired", () => {
  const base = { format_version: 1, id: "change-test", project: "test", workspace_key: "workspace", base_revision: "base", status: "active", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), store_type: "embedded", targets: [] };
  assert.throws(() => changes.memoryChangeSetSchema.parse({ ...base, intent: "system_upgrade" }), /must be paired/);
});


test("System upgrade metadata reads old delete targets and freezes new approved digests", () => {
  const base = { format_version: 1, id: "change-test", project: "test", workspace_key: "workspace", base_revision: "base", status: "active",
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(), store_type: "managed", targets: [], intent: "system_upgrade" };
  const target = { reference: "procedures/legacy", path: "procedures/legacy.yaml", operation: "delete" };
  const metadata = { source_digest: "old-bundle", instance_key: "workspace", targets: [target] };
  assert.equal(changes.memoryChangeSetSchema.parse({ ...base, system_upgrade: metadata }).system_upgrade?.targets[0]?.approvedContentDigest, undefined);
  const digest = "a".repeat(64);
  assert.equal(changes.memoryChangeSetSchema.parse({ ...base, system_upgrade: { ...metadata, targets: [{ ...target, approvedContentDigest: digest }] } }).system_upgrade?.targets[0]?.approvedContentDigest, digest);
  assert.throws(() => changes.memoryChangeSetSchema.parse({ ...base, system_upgrade: { ...metadata, targets: [{ ...target, approvedContentDigest: "invalid" }] } }));
});
