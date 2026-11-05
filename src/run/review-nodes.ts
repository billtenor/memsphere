import { createReviewNodes, type ReviewNodeSource, type ReviewSource } from "../review-nodes.js";
import { type RunState, type RunStep, type RunSchemaNode } from "./store.js";

export function createFlowReviewNodes(run: RunState, step: RunStep) {
  const frame = run.stack.filter(f => f.type === "procedure").at(-1), memoryRef = `procedures/${frame?.memoryName ?? run.procedureName}`;
  // flow execution refs are one-based; source/rule paths retain AST array indexes.
  const stepPath = step.id.replace(/\[(\d+)\]/g, (_, i) => `[${Number(i) - 1}]`) + (step.kind === "branch" || step.kind === "loop" ? ".condition" : "");
  function schemaSource(node: RunSchemaNode, source: ReviewSource, name: string): ReviewNodeSource {
    source = node.reviewSource ?? source;
    const children: ReviewNodeSource[] = [];
    const childSource = (path: string) => ({ ...source, path: source.path === "." ? path : `${source.path}.${path}` });
    (node.fields ?? []).forEach((field, i) => {
      if (typeof field === "object" && field.tag === "!schema") children.push(schemaSource(field, childSource(`fields[${i}]`), field.names[0]));
      if (typeof field === "object" && field.tag === "!repeat") field.body.forEach((child, j) => {
        if (typeof child === "object" && child.tag === "!schema") children.push(schemaSource(child, childSource(`fields[${i}].body[${j}]`), child.names[0]));
      });
    });
    if (node.item?.tag === "!schema") children.push(schemaSource(node.item, childSource("item"), node.item.names[0]));
    node.items?.forEach((item, i) => { if (item.tag === "!schema") children.push(schemaSource(item, childSource(`items[${i}]`), item.names[0])); });
    return { source, name, defines: node.defines, asserts: node.assertTree, suggests: node.suggestTree, children };
  }
  return createReviewNodes([
    ...run.stack.filter(f => f.type === "procedure").map(f => ({ source: { kind: "procedure" as const, memoryRef: `procedures/${f.memoryName}`, path: "." }, name: f.memoryName, defines: run.procedureSnapshots?.[f.memoryName]?.defines, asserts: f.assertTree })),
    { source: { kind: "step", memoryRef, path: stepPath }, name: step.instruction, asserts: step.assertTree, suggests: step.suggestTree },
    ...(step.schema?.node ? [schemaSource(step.schema.node, step.schema.kind === "external" ? { kind: "schema", memoryRef: `schemas/${step.schema.name}`, path: "." } : { kind: "step", memoryRef, path: `${stepPath}.artifact.schema` }, step.artifact ?? "Artifact")] : []),
    ...(step.schemaContext?.sources ?? []).map(s => ({ source: s.reviewSource ?? { kind: "schema" as const, path: s.path }, name: s.path, defines: s.defines, asserts: s.assertTree, suggests: s.suggestTree }))
  ], run.language === "en" ? "Open review" : "开放审查");
}
