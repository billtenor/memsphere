import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gitHashObject, missingGitMessage, runGit } from "../src/git.js";

test("gitHashObject hashes the exact bytes supplied on stdin", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-git-hash-"));
  const path = join(root, "bytes.bin");
  const source = Buffer.from([0x4c, 0x46, 0x0a, 0x43, 0x52, 0x4c, 0x46, 0x0d, 0x0a, 0x00, 0xff]);
  try {
    await writeFile(path, source);
    const expected = (await runGit(["hash-object", "--", "bytes.bin"], { cwd: root })).stdout;
    assert.equal(await gitHashObject(source, root), expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("gitHashObject applies Git path filters without asking Git to open the source path", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-git-filtered-hash-"));
  const path = join(root, "memory.txt");
  const source = Buffer.from("first\r\nsecond\r\n");
  try {
    await writeFile(join(root, ".gitattributes"), "*.txt text\n");
    await writeFile(path, source);
    await runGit(["init", "-b", "master"], { cwd: root });
    const expected = (await runGit(["hash-object", "--", "memory.txt"], { cwd: root })).stdout;
    await rm(path);
    assert.equal(await gitHashObject(source, root, "memory.txt"), expected);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

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
  const readmeZhCn = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const readmeEn = await readFile(new URL("../README.en.md", import.meta.url), "utf8");

  assert.match(readmeEn, /Reopen PowerShell, CMD, Git Bash, or another supported shell/);
  assert.match(readmeEn, /does not require Git Bash/);
  assert.match(readmeZhCn, /重新打开 PowerShell、CMD 或 Git Bash 等受支持 shell/);
  assert.match(readmeZhCn, /不要求先进入 Git Bash/);
  assert.doesNotMatch(readmeZhCn, /在 Git Bash 中使用 Memsphere/);
});
