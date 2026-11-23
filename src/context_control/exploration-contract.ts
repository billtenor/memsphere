import type { MemsphereConfig } from "../config.js";
import { createMemoryCatalogForConfig } from "../memory/factory.js";
import { collectMemoryReferenceTargets } from "../memory/references.js";
import { serializeMemoryYaml } from "../memory/serializer.js";
import { MEMSPHERE_SCHEMA_MODEL } from "../memory/schema-model.js";
import { flattenEffectiveRules, resolveRuleParts } from "../memory/rules.js";
import { failure } from "./errors.js";
import { freezeSchemaContract } from "./schema-contract.js";
import type { Run, StepReviewConfiguration } from "./types.js";

export async function freezeExplorationSchema(config: MemsphereConfig, name: string, schema: string, contentType: string) {
  const live = createMemoryCatalogForConfig(config), catalog = await live.snapshot?.() ?? live;
  const descriptor = await catalog.resolve(schema, { kind: "schemas" });
  const memories: NonNullable<Run["memorySnapshot"]>["memories"] = {};
  async function capture(ref: string) {
    if (Object.hasOwn(memories, ref)) return;
    const entity = await catalog.read(ref);
    memories[ref] = { memoryRef: ref, payload: { contentType: "application/yaml", content: serializeMemoryYaml(entity) } };
    for (const target of collectMemoryReferenceTargets(entity)) await capture(target);
  }
  await capture(descriptor.reference);
  return freezeSchemaContract({ name, model: { definedBy: MEMSPHERE_SCHEMA_MODEL, ref: descriptor.reference }, payload: { contentType } }, memories,
    { kind: "schema", path: ".", memoryRef: descriptor.reference });
}

export function explorationReviewerOptions(config: MemsphereConfig) {
  const options = [{ value: "runner", name: "Runner" }];
  for (const [id, actor] of Object.entries(config.controlPlane?.actors ?? {})) {
    if (actor.kind === "agent" && actor.permissions.includes("artifact.read") && actor.permissions.some(p => p === "decision.assess" || p === "decision.decide")) {
      options.push({ value: `project:${id}`, name: actor.name || id });
    }
  }
  return options;
}

export async function explorationRules(config: MemsphereConfig, setting: Pick<StepReviewConfiguration, "asserts" | "suggests">) {
  const live = createMemoryCatalogForConfig(config), catalog = await live.snapshot?.() ?? live;
  const rules = async (channel: "asserts" | "suggests") => {
    const refs = await Promise.all((setting[channel] ?? []).map(ref => catalog.resolve(ref, { kind: "statements" })));
    const references = [...new Set(refs.map(d => d.reference))];
    const tree = await resolveRuleParts(channel, references.map(target => ({ tag: "!ref" as const, target })), async ref => {
      const entity = await catalog.read(ref, { kind: "statements" });
      if (entity.tag !== "!statement") throw failure("INVALID_ARGUMENT", `Expected Statement: ${ref}`);
      return entity;
    });
    return { references, tree, count: flattenEffectiveRules(tree).length };
  };
  const [asserts, suggests] = await Promise.all([rules("asserts"), rules("suggests")]);
  return { asserts, suggests };
}
