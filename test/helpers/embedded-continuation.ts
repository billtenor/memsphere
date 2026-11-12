import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkspaceIdentity } from "../../src/project/workspace.js";
import { runGit } from "../../src/git.js";
import { validateMemoryChange } from "../../src/memory/changeset.js";
import { currentMemorySyntax } from "../../src/memory/syntax.js";
import { readProjectRegistry } from "../../src/project/registry.js";
import { createGhTransport } from "../../src/memory/embedded-context.js";

export const concept = (text: string, name = "example") => `!concept\nsyntax: ${currentMemorySyntax}\nnames: [${name}]\ndefines: [${text}]\n`;
export async function fixture(run: (f: { main: string; linked: string; home: string; memory: string; changes: string }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "memsphere-continuation-"));
  const previous = { cwd: process.cwd(), home: process.env.MEMSPHERE_HOME, project: process.env.MEMSPHERE_PROJECT, git: process.env.GIT_CONFIG_GLOBAL };
  try {
    const main = join(root, "main"), linked = join(root, "linked"), home = join(root, "home"), git = join(root, "gitconfig");
    await mkdir(main); await writeFile(git, "[user]\nname = Fixture\nemail = fixture@example.com\n");
    process.env.GIT_CONFIG_GLOBAL = git; process.env.MEMSPHERE_HOME = home; process.env.MEMSPHERE_PROJECT = "embedded";
    await runGit(["init", "-b", "master"], { cwd: main });
    // Exact-byte preflight assertions use LF; attributes tests override paths
    // explicitly instead of inheriting a runner's checkout conversion policy.
    await runGit(["config", "core.autocrlf", "false"], { cwd: main });
    for (const kind of ["concepts", "statements", "procedures", "schemas"]) await mkdir(join(main, "memory", kind), { recursive: true });
    await writeFile(join(main, "memory/concepts/example.yaml"), concept("Base"));
    await runGit(["add", "memory"], { cwd: main }); await runGit(["commit", "-m", "base"], { cwd: main });
    process.chdir(main);
    const projectRoot = join(home, "projects", "embedded");
    await mkdir(projectRoot, { recursive: true });
    await writeFile(join(projectRoot, "project.json"), JSON.stringify({ format_version: 1, name: "embedded", created_at: "2026-01-01T00:00:00.000Z" }));
    await writeFile(join(projectRoot, "config.json"), JSON.stringify({ store: { type: "embedded", repository_path: main, memory_path: "memory" } }));
    const identity = await resolveWorkspaceIdentity(main);
    await writeFile(join(home, "registry.json"), JSON.stringify({ format_version: 1, projects: { embedded: { root: projectRoot } }, workspaces: { [identity.key]: { primary: "embedded", mounted: [] } } }));
    await runGit(["worktree", "add", "--detach", linked], { cwd: main }); process.chdir(linked);
    const project = (await readProjectRegistry(home)).projects.embedded;
    await run({ main, linked, home, memory: join(linked, "memory"), changes: join(project.root, "changes") });
  } finally {
    process.chdir(previous.cwd);
    for (const [key, value] of [["MEMSPHERE_HOME", previous.home], ["MEMSPHERE_PROJECT", previous.project], ["GIT_CONFIG_GLOBAL", previous.git]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}

export async function ghFixture(home: string, prs: number[]) {
  const script = join(home, "gh-fixture.cjs");
  await writeFile(script, `const args=process.argv.slice(2); if(args[0]!=="api"||args[1]!=="--hostname"||args[2]!=="github.com")process.exit(9);
    const endpoint=args.at(-1); const result=endpoint.includes("/pulls?") ? [[],${JSON.stringify(prs.map(number => ({ number, head: { ref: "feature", repo: { full_name: "owner/repo" } }, base: { ref: "master", repo: { full_name: "owner/repo" } } })))}] : {full_name:"owner/repo",fork:false};
    if(endpoint.includes("/pulls?")&&(!args.includes("--paginate")||!args.includes("--slurp")))process.exit(10);
    process.stdout.write(JSON.stringify(result));`);
  return createGhTransport(process.execPath, [script]);
}

export async function claimFixture(f: { memory: string; home: string; linked: string }, run: (id: string, destination: string) => Promise<void>) {
  await writeFile(join(f.memory, "concepts/example.yaml"), concept("Changed"));
  await writeFile(join(f.memory, "concepts/second.yaml"), concept("Second", "second"));
  const first = await validateMemoryChange();
  const destination = join(f.home, "claim"); await runGit(["worktree", "add", "--detach", destination]); process.chdir(destination);
  await run(first.changeId, destination);
}
