// @integration-platform: native — verifies real filesystem, process or build-adapter behavior.
import assert from "node:assert/strict";

import test, { type TestContext } from "node:test";

import { readFile, writeFile } from "node:fs/promises";

import { join } from "node:path";

import { initializedContextFixture } from "./helpers/initialized-context.js";

import { openContextControl } from "../src/project/context-control.js";

import { parseMemoryEntity } from "../src/memory/store.js";

import { graphMemorySyntax } from "../src/memory/syntax.js";

import type { GraphAction, GraphProcedureMemory } from "../src/memory/ast.js";

import type { GraphRuntime } from "../src/context_control/graph-runtime.js";

import type { Run, Step } from "../src/context_control/types.js";

import type { ControlPlaneConfig, RunReviewConfiguration } from "../src/control-plane/index.js";

const spec = (review?: string[]) => ({ name: "Result", model: { definedBy: "json-schema/draft-07.json", definition: '{"type":"string"}' }, payload: { contentType: "application/json" }, ...(review ? { review } : {}) });

function action(id: string, from: string | string[] = "START", when?: string): GraphAction {
  return { tag: "!action", id, description: `Produce ${id}`, dependencies: [{ tag: "!dependency", from, ...(when ? { when } : {}) }], artifact: spec() };
}

function procedure(actions: GraphAction[]): GraphProcedureMemory { return parseMemoryEntity("procedures", { tag: "!procedure", syntax: graphMemorySyntax, mode: "graph", names: ["runtime-graph"], defines: ["A graph"], actions }) as GraphProcedureMemory; }

async function fixture(t: TestContext) {
  const { root } = await initializedContextFixture(t); const service = (await openContextControl(root))!;
  return { root, service, use: <T>(fn: (g: GraphRuntime) => Promise<T>) => service.withGraph(fn) };
}

async function produce(g: GraphRuntime, runId: string, stepId: string, value: string, revisionSummary?: string) {
  await g.enter(runId, stepId); return g.report(runId, stepId, { text: JSON.stringify(value), ...(revisionSummary ? { revisionSummary } : {}) });
}

const byAction = (steps: Step[], id: string) => steps.filter(s => s.source?.actionId === id);

const cp: ControlPlaneConfig = { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, acpProviders: {}, actors: { human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] } } };

const bindings: RunReviewConfiguration = { reviews: { "runtime-graph#actions[A]": { policy: "artifact_acceptance.unanimous" } }, slots: { "runtime-graph::approval": { actorIds: ["human"] } } };

test("corrupt done-with-round submission cannot recover past its unaccepted Review", async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const A = action("A"); A.artifact = spec(["approval"]);
    const start = await g.start({ name: "review integrity", procedure: procedure([A, action("B", "A")]), controlPlane: { runner: { permissions: ["artifact.read", "artifact.submit", "decision.decide"] }, actors: { human: { kind: "human", name: "Human", permissions: ["artifact.read", "decision.decide"] } } }, reviewConfiguration: { reviews: { "runtime-graph#actions[A]": { policy: "artifact_acceptance.unanimous" } }, slots: { "runtime-graph::approval": { actorIds: ["human"] } } } });
    const id = start.steps[0].id; await g.enter(start.run.id, id);
    const create = f.service.stores.artifact.create.bind(f.service.stores.artifact);
    f.service.stores.artifact.create = async () => { throw Error("candidate creation interruption"); };
    await assert.rejects(g.report(start.run.id, id, { text: '"candidate"' }), /candidate creation interruption/);
    f.service.stores.artifact.create = create;
    const path = join(f.root, `data/context_control/steps/${start.run.id}/${id}.json`);
    const row = JSON.parse(await readFile(path, "utf8")), stage = row.value.frames[0].submissionFrame;
    assert.equal(stage.nextStatus, "awaiting_review"); assert.ok(stage.round);
    stage.nextStatus = "done"; await writeFile(path, JSON.stringify(row));
    const reopened = (await openContextControl(f.root))!;
    await assert.rejects(reopened.withGraph(g => g.advance(start.run.id)), /discriminated.*round/);
    assert.equal((await reopened.stores.artifact.list({})).items.length, 0);
    assert.equal((await reopened.stores.review.list({})).items.length, 0);
    const run = (await reopened.stores.run.get({}, start.run.id))!.value as Run;
    assert.equal(run.frames![0].graphFrame.triggers.some(t => t.actionId === "B"), false);
    assert.equal(JSON.parse(await readFile(path, "utf8")).value.status, "running");
  });
});

for (const conflict of ["different", "duplicate", "schema"] as const) test(`graph refuses ${conflict} recovery intents without creating or completing anything`, async t => {
  const f = await fixture(t);
  await f.use(async g => {
    const A = action("A"); A.artifact = spec(["approval"]);
    const start = await g.start({ name: "ambiguous recovery", procedure: procedure([A, action("B", "A")]), controlPlane: cp, reviewConfiguration: bindings });
    const id = start.steps[0].id; await g.enter(start.run.id, id);
    const create = f.service.stores.artifact.create.bind(f.service.stores.artifact);
    f.service.stores.artifact.create = async () => { throw Error("staged candidate interruption"); };
    await assert.rejects(g.report(start.run.id, id, { text: '"candidate"' }), /staged candidate interruption/);
    f.service.stores.artifact.create = create;
    const key = `${start.run.id}/${id}`, path = join(f.root, `data/context_control/steps/${key}.json`);
    const row = JSON.parse(await readFile(path, "utf8")), first = structuredClone(row.value.frames[0]), second = structuredClone(first);
    first.submissionFrame.nextStatus = "done"; delete first.submissionFrame.round;
    second.id = `second-${first.id}`;
    if (conflict === "different") {
      second.submissionFrame.artifact.id = `second-${second.submissionFrame.artifact.id}`;
      second.submissionFrame.round.artifactId = second.submissionFrame.artifact.id;
    } else if (conflict === "duplicate") second.submissionFrame = structuredClone(first.submissionFrame);
    else { second.type = "schema"; delete second.submissionFrame; second.schemaFrame = { sequence: [], index: 0, decisions: [] }; }
    row.value.frames = [first, second];
    // A backend that returns values without the reserved-model validator still
    // crosses the same domain recovery guard; no silent first-frame selection.
    const get = f.service.stores.step.get.bind(f.service.stores.step);
    f.service.stores.step.get = async (...args) => {
      const found = await get(...args); return found && args[1] === key ? { ...found, value: row.value } : found;
    };
    await assert.rejects(g.snapshot(start.run.id), /sole recovery intent/);
    await assert.rejects(g.advance(start.run.id), /sole recovery intent/);
    f.service.stores.step.get = get;
    await writeFile(path, JSON.stringify(row));
    const reopened = (await openContextControl(f.root))!;
    await assert.rejects(reopened.withGraph(g => g.advance(start.run.id)), /sole recovery intent/);
    assert.equal((await reopened.stores.artifact.list({})).items.length, 0);
    assert.equal((await reopened.stores.review.list({})).items.length, 0);
    const run = (await reopened.stores.run.get({}, start.run.id))!.value as Run;
    assert.equal(run.frames![0].graphFrame.triggers.some(t => t.actionId === "B"), false);
    assert.equal(run.frames![0].graphFrame.nextCompletionSequence, 1);
    const unchanged = JSON.parse(await readFile(path, "utf8")).value;
    assert.equal(unchanged.status, "running"); assert.equal(unchanged.frames.length, 2);
  });
});

for (const materials of [[], ["资料甲", "资料乙"]]) test(`published materials example completes with ${materials.length} materials and automatic collect`, async t => {
  const { readFile } = await import("node:fs/promises"); const { parseMemoryYaml } = await import("../src/memory/yaml.js");
  const document = (await readFile(new URL("../docs/procedure-graph-syntax.md", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
  const yaml = [...document.matchAll(/```yaml\n([\s\S]*?)```/g)].map(m => m[1]).find(text => text.startsWith("!procedure\n") && text.includes("mode: graph\n"))!;
  const definition = parseMemoryEntity("procedures", parseMemoryYaml(yaml)) as GraphProcedureMemory;
  const f = await fixture(t);
  await f.use(async g => {
    let snapshot = await g.start({ name: "materials", procedure: definition, reviewConfiguration: { reviews: { "analyze-materials#actions[analyze]": { policy: "artifact_acceptance.unanimous" } }, slots: { "analyze-materials::领域专家": { skip: true } } } });
    const submit = async (step: Step, value: unknown, markdown = false) => { await g.enter(snapshot.run.id, step.id); const result = await g.report(snapshot.run.id, step.id, { text: markdown ? String(value) : JSON.stringify(value) }); snapshot = result.snapshot; return result; };
    await submit(snapshot.steps[0], { remaining: materials });
    for (let iteration = 0; iteration < 10; iteration++) {
      const step = g.ready(snapshot)[0]; assert.ok(step);
      if (step.source!.actionId === "summarize") { await submit(step, materials.length ? "分析完成" : "本次没有资料", true); break; }
      const ref = Object.values(step.inputs!).flat()[0];
      const input = JSON.parse(Buffer.from((await g.readArtifact(snapshot.run.id, ref.id)).bytes).toString("utf8"));
      if (step.source!.actionId === "check") await submit(step, { remaining: input.remaining, hasMore: input.remaining.length > 0 });
      else await submit(step, { material: input.remaining[0], finding: "结论", remaining: input.remaining.slice(1) });
    }
    const analyses = byAction(snapshot.steps, "analyze"); assert.equal(analyses.length, materials.length);
    const aggregate = byAction(snapshot.steps, "gather")[0]; assert.equal(aggregate.status, "done");
    assert.equal((aggregate.artifact as { items: Record<string, string[]> }).items.analyze.length, materials.length);
    assert.ok(snapshot.steps.every(s => s.status === "done")); assert.equal((await g.finish(snapshot.run.id)).status, "done");
  });
});
