import assert from "node:assert/strict";
import test from "node:test";
import { procedureMemorySchema } from "../src/memory/schema.js";
import { parseMemoryYaml } from "../src/memory/yaml.js";
import { serializeMemoryYaml } from "../src/memory/serializer.js";


const action = (review = false, type = "object", format = "json") => `  - !action
    action: Produce a model value.
    artifact: !artifact
      name: result
      type: ${type}
      format: ${format}
      store: records
${review ? '      review: [owner]\n' : ''}`;


test("model Artifact syntax round-trips while unsupported combinations fail", () => {
  const source = `!procedure\nsyntax: memsphere-20260721-stable\nname: model-flow\nflow:\n${action(false, "boolean")}`;
  const parsed = procedureMemorySchema.parse(parseMemoryYaml(source));
  assert.deepEqual(procedureMemorySchema.parse(parseMemoryYaml(serializeMemoryYaml(parsed))), parsed);
  for (const invalid of [source.replace('      store: records\n', ''), source.replace('      store: records', '      model: record.json'), source.replace('      format: json', '      format: markdown')])
    assert.throws(() => procedureMemorySchema.parse(parseMemoryYaml(invalid)));
});
