import assert from "node:assert/strict";
import test from "node:test";
import type { MemoryEntity, ProcedureMemory, SchemaMemory, StatementMemory } from "../src/memory/ast.js";
import {
  MemoryNavigation,
  MemoryNodeNotFoundError,
  type MemoryIdentity
} from "../src/memory/navigation.js";

function identity(kind: MemoryIdentity["kind"], name: string): MemoryIdentity {
  return { reference: `${kind}/${name}`, kind, names: [name] };
}

test("Statement navigation lists direct sections and preserves root and ancestor constraints", () => {
  const statement: StatementMemory = {
    tag: "!statement",
    names: ["Repository rules"],
    defines: ["Rules for the repository."],
    asserts: ["All sections apply."],
    sections: [{
      tag: "!statement",
      names: ["Testing"],
      defines: ["Testing rules."],
      suggests: ["Prefer focused tests."],
      sections: [{
        tag: "!statement",
        names: ["Core logic"],
        defines: [],
        asserts: ["Core changes require tests."]
      }]
    }]
  };
  const navigation = new MemoryNavigation(identity("statements", "Repository rules"), statement);

  const root = navigation.listChildren();
  assert.deepEqual(root.nodes, [{
    node_ref: "statement:Testing",
    type: "Statement",
    name: "Testing",
    summary: "Testing rules.",
    relation: "section",
    has_children: true
  }]);

  const children = navigation.listChildren("statement:Testing");
  assert.deepEqual(children.nodes.map((node) => node.node_ref), ["statement:Testing/statement:Core logic"]);

  const read = navigation.readNode("statement:Testing/statement:Core logic");
  assert.equal((read.context.root as StatementMemory).sections, undefined);
  assert.deepEqual((read.context.root as StatementMemory).asserts, ["All sections apply."]);
  assert.equal(read.context.ancestors.length, 1);
  assert.equal(read.context.ancestors[0].node_ref, "statement:Testing");
  assert.equal((read.context.ancestors[0].value as StatementMemory).sections, undefined);
  assert.deepEqual((read.fragment as StatementMemory).asserts, ["Core changes require tests."]);
});

test("Schema navigation exposes fields under Repeat while retaining Repeat and parent Schema context", () => {
  const schema: SchemaMemory = {
    tag: "!schema",
    names: ["Report"],
    defines: ["A report."],
    format: "outline",
    fields: [
      "Title",
      {
        tag: "!schema",
        names: ["Details"],
        defines: ["Report details."],
        fields: ["Amount"]
      },
      {
        tag: "!repeat",
        limit: { min: 1, max: 3 },
        body: [
          "Note",
          {
            tag: "!schema",
            names: ["Item"],
            defines: [],
            fields: ["Value"]
          }
        ]
      }
    ]
  };
  const navigation = new MemoryNavigation(identity("schemas", "Report"), schema);

  assert.deepEqual(navigation.listChildren().nodes.map((node) => node.node_ref), [
    "string:Title",
    "schema:Details",
    "repeat[1]/string:Note",
    "repeat[1]/schema:Item"
  ]);
  assert.deepEqual(navigation.listChildren("schema:Details").nodes.map((node) => node.node_ref), [
    "schema:Details/string:Amount"
  ]);

  const read = navigation.readNode("repeat[1]/schema:Item/string:Value");
  assert.equal((read.context.root as SchemaMemory).fields, undefined);
  assert.deepEqual(read.context.ancestors.map((entry) => entry.type), ["Repeat", "Schema"]);
  assert.deepEqual(read.context.ancestors[0].value, { tag: "!repeat", limit: { min: 1, max: 3 } });
  assert.equal((read.context.ancestors[1].value as SchemaMemory).fields, undefined);
  assert.equal(read.fragment, "Value");
});

function action(name: string, instruction = `Produce ${name}`): ProcedureMemory["flow"][number] {
  return {
    tag: "!action",
    action: instruction,
    artifact: { tag: "!artifact", name, format: "markdown" }
  };
}

function booleanAction(name: string, instruction: string) {
  return {
    tag: "!action" as const,
    action: instruction,
    artifact: { tag: "!artifact" as const, name, format: "boolean" as const }
  };
}

test("Procedure navigation uses Artifact names as fixed references and preserves control context", () => {
  const procedure: ProcedureMemory = {
    tag: "!procedure",
    names: ["Review flow"],
    defines: ["Review something."],
    asserts: ["Keep evidence."],
    goals: ["Finish review."],
    flow: [
      action("Result/One#A", "Prepare the review."),
      {
        tag: "!if",
        condition: booleanAction("Continue", "Decide whether to continue."),
        then: [action("Result"), action("Result")],
        elseif: {
          tag: "!if",
          condition: booleanAction("Fallback", "Decide whether to use fallback."),
          then: [{ tag: "!call", target: "Fallback procedure" }]
        },
        else: [action("Stopped")]
      },
      {
        tag: "!while",
        condition: booleanAction("Retry", "Decide whether to retry."),
        do: [{ tag: "!call", target: "Worker" }]
      },
      { tag: "!call", target: "Shared" },
      { tag: "!call", target: "Shared" }
    ]
  };
  const navigation = new MemoryNavigation(identity("procedures", "Review flow"), procedure);

  assert.deepEqual(navigation.listChildren().nodes.map((node) => node.node_ref), [
    "action:Result~1One~2A",
    "if:Continue",
    "while:Retry",
    "call:Shared",
    "call:Shared#2"
  ]);
  const rootNodes = navigation.listChildren().nodes;
  assert.equal(rootNodes[0].artifact, "Result/One#A");
  assert.equal(rootNodes[1].condition_artifact, "Continue");
  assert.equal(rootNodes[2].condition_artifact, "Retry");
  assert.equal(rootNodes[3].artifact, undefined);
  assert.equal(rootNodes[3].target, "Shared");

  assert.deepEqual(navigation.listChildren("if:Continue").nodes.map((node) => node.node_ref), [
    "if:Continue/then/action:Result",
    "if:Continue/then/action:Result#2",
    "if:Continue/elseif/if:Fallback",
    "if:Continue/else/action:Stopped"
  ]);

  const read = navigation.readNode("if:Continue/then/action:Result#2");
  assert.deepEqual((read.context.root as ProcedureMemory).asserts, ["Keep evidence."]);
  assert.equal((read.context.root as ProcedureMemory).flow, undefined);
  assert.equal(read.context.ancestors.length, 1);
  assert.equal(read.context.ancestors[0].type, "If");
  assert.equal(read.context.ancestors[0].relation, "then");
  assert.equal(
    ((read.context.ancestors[0].value as { condition: { artifact: { name: string } } }).condition.artifact.name),
    "Continue"
  );
  assert.equal((read.fragment as { artifact: { name: string } }).artifact.name, "Result");

  const loopChild = navigation.readNode("while:Retry/do/call:Worker");
  assert.equal(loopChild.context.ancestors[0].type, "While");
  assert.equal(loopChild.context.ancestors[0].relation, "do");

  const elseChild = navigation.readNode("if:Continue/else/action:Stopped");
  assert.deepEqual(
    elseChild.context.ancestors.map((entry) =>
      ((entry.value as { condition: { artifact: { name: string } } }).condition.artifact.name)
    ),
    ["Continue", "Fallback"]
  );
  assert.deepEqual(elseChild.context.ancestors.map((entry) => entry.relation), ["else", "else"]);
});

test("Concept navigation is empty and unknown node references fail clearly", () => {
  const concept: MemoryEntity = {
    tag: "!concept",
    names: ["Memory"],
    defines: ["A memory."]
  };
  const navigation = new MemoryNavigation(identity("concepts", "Memory"), concept);
  assert.deepEqual(navigation.listChildren().nodes, []);
  assert.throws(
    () => navigation.readNode("statement:Missing"),
    (error: unknown) => error instanceof MemoryNodeNotFoundError
      && /memsphere memory list/.test(error.message)
  );
});
