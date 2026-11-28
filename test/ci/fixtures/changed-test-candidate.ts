import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";
import { promisify } from "node:util";

const exec = promisify(execFile);
export async function changedTestCandidate(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "memsphere-changed-candidate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = async (...args: string[]) => (await exec("git", [
    "-c", "user.name=Changed Test", "-c", "user.email=changed@example.test", "-c", "commit.gpgsign=false", ...args
  ], { cwd: root })).stdout.trim();
  const put = async (file: string, text: string) => {
    const path = join(root, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  };
  const commit = async (name: string) => {
    await git("add", "--all");
    await git("commit", "--no-verify", "-qm", name);
    return git("rev-parse", "HEAD");
  };
  await git("init", "-b", "master");
  await put(".gitignore", "node_modules/\n");
  await put("test/default.unit.test.ts", "");
  return { root, git, put, commit };
}
