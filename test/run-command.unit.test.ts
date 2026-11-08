import assert from "node:assert/strict";

import { Readable } from "node:stream";



import test from "node:test";

import { parseRunReviewConfiguration, runStartCommand, resolveReviewCommentBody, validateInlineReviewCommentBody } from "../src/commands/run.js";











function ruleTree(channel: "asserts" | "suggests", ...texts: string[]) {
  return {
    channel,
    entries: texts.map((text, index) => ({ kind: "rule" as const, text, ruleId: `test:${channel}[${index}]` })),
    sections: []
  };
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

test("run start command rejects missing, blank, and control-character names", async () => {
  await assert.rejects(runStartCommand("procedure"), /run name is required/);
  await assert.rejects(runStartCommand("procedure", { name: "   " }), /run name is required/);
  await assert.rejects(
    runStartCommand("procedure", { name: "line one\nline two" }),
    /run name must not contain control characters/
  );
});

test("run start command parses skipped and Actor-bound Review Slots without requiring a control plane", () => {
  assert.deepEqual(parseRunReviewConfiguration({
    reviews: {
      "delivery#flow[1]": { policy: "artifact_acceptance.unanimous" }
    },
    slots: {
      "delivery::optional": { skip: true },
      "delivery::required": { actors: ["human"] }
    }
  }), {
    reviews: {
      "delivery#flow[1]": { policy: "artifact_acceptance.unanimous" }
    },
    slots: {
      "delivery::optional": { skip: true },
      "delivery::required": { actorIds: ["human"] }
    }
  });
  assert.throws(
    () => parseRunReviewConfiguration({ reviews: {}, slots: { "delivery::reviewer": {} } }),
    /actors must be a string array or skip must be true/
  );
});

test("inline Artifact Review comments reject escaped multiline Markdown", () => {
  assert.doesNotThrow(() => validateInlineReviewCommentBody("A short comment about `\\n`."));
  assert.throws(
    () => validateInlineReviewCommentBody("First paragraph\\n\\nSecond paragraph"),
    /multiline Markdown must use --body-stdin/
  );
});

test("Artifact Review comments accept multiline Markdown from standard input", async () => {
  assert.equal(
    await resolveReviewCommentBody(
      { bodyStdin: true },
      Readable.from(["First paragraph\n", "\nSecond paragraph\n"])
    ),
    "First paragraph\n\nSecond paragraph\n"
  );
  await assert.rejects(
    resolveReviewCommentBody({ body: "inline", bodyStdin: true }, Readable.from([])),
    /use only one of --body, --body-file, or --body-stdin/
  );
});
