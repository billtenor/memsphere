import assert from "node:assert/strict";
import test from "node:test";
import { missingGitMessage } from "../src/git.js";


test("missing Git guidance keeps Windows CLI shells neutral", () => {
  const message = missingGitMessage("win32");

  assert.match(message, /Install Git for Windows/);
  assert.match(message, /PowerShell, CMD, or Git Bash/);
  assert.match(message, /available on PATH/);
  assert.doesNotMatch(message, /run Memsphere from Git Bash/);
});


test("missing Git guidance remains portable outside Windows", () => {
  assert.equal(
    missingGitMessage("linux"),
    "Git is required but was not found. Install Git and ensure it is available on PATH."
  );
});
