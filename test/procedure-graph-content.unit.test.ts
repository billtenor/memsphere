import assert from "node:assert/strict";
import test from "node:test";
import { decodeGraphContent, validateGraphBody } from "../src/context_control/graph-content.js";
const bytes = (text: string) => Buffer.from(text);
test("graph decoding rejects invalid UTF-8, unsafe JSON values and YAML-specific values", () => {
  assert.throws(() => decodeGraphContent(new Uint8Array([0xff]), "text/plain"));
  assert.throws(() => decodeGraphContent(bytes('{"n":9007199254740993}'), "application/json"));
  assert.throws(() => decodeGraphContent(bytes("x: .inf"), "application/yaml"));
  assert.throws(() => decodeGraphContent(bytes("x: 1\nx: 2"), "application/yaml"));
  assert.deepEqual(decodeGraphContent(bytes("items: [one, two]"), "application/yaml"), { items: ["one", "two"] });
});
test("graph contentRef checks the original bytes before model decoding", async () => {
  await assert.rejects(validateGraphBody({ contentRef: { storeId: "source", dataId: "id", sha256: "0".repeat(64) } }, { name: "Result", model: { definedBy: "raw.json", definition: "{}" }, payload: { contentType: "text/plain" } }, async () => ({ bytes: bytes("changed"), contentType: "text/plain" })), { code: "CONTENT_CHANGED" });
});
