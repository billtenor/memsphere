// @integration-platform: native — verifies real filesystem, process or build-adapter behavior.
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resolveReviewCommentBody } from "../src/commands/run.js";






function ruleTree(channel: "asserts" | "suggests", ...texts: string[]) {
  return {
    channel,
    entries: texts.map((text, index) => ({ kind: "rule" as const, text, ruleId: `test:${channel}[${index}]` })),
    sections: []
  };
}

test("Artifact Review comments accept multiline Markdown from a file", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-comment-"));
  const path = join(root, "comment.md");
  try {
    await writeFile(path, "First paragraph\n\nSecond paragraph\n", "utf8");
    assert.equal(
      await resolveReviewCommentBody({ bodyFile: path }, Readable.from([])),
      "First paragraph\n\nSecond paragraph\n"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}
