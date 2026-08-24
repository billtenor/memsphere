import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("README documents native Windows shells without requiring Git Bash", async () => {
  const readmeEn = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const readmeZhCn = await readFile(
    new URL("../README.zh-CN.md", import.meta.url),
    "utf8"
  );

  assert.match(readmeEn, /Reopen PowerShell, CMD, Git Bash, or another supported shell/);
  assert.match(readmeEn, /does not require Git Bash/);
  assert.match(readmeZhCn, /重新打开 PowerShell、CMD 或 Git Bash 等受支持 shell/);
  assert.match(readmeZhCn, /不要求先进入 Git Bash/);
  assert.doesNotMatch(readmeZhCn, /在 Git Bash 中使用 Memsphere/);
});
