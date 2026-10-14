// Run from the repository root; Chromium must be permitted to launch.
// Reuses the real View fixture instead of duplicating a production cache API.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repository = process.cwd();
const fixtureFile = resolve(repository, "test/view-responsive.test.ts");
const source = await readFile(fixtureFile, "utf8");
const boundary = source.indexOf("async function openTaskPage");
if (boundary < 0) throw new Error("View fixture boundary changed; update this verifier");
const fixture = source.slice(0, boundary).replace(/from "((?:\.\/helpers\/|\.\.\/src\/)[^"]+)"/g,
  (_match, target) => `from ${JSON.stringify(pathToFileURL(resolve(dirname(fixtureFile), target)).href)}`);
const temporary = await mkdtemp(join(tmpdir(), "memsphere-lifecycle-verifier-"));
const program = join(temporary, "verify.mts");
try {
  await writeFile(program, fixture + `
import { writeHeapSnapshot } from "node:v8";
test("disposable ChangeSet detail roots are not retained", async () => {
  await withResponsiveView(async (_browser, url) => {
    const created = await fetch(url + "/api/projects/responsive/changes", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ memoryReference: "procedures/reviewable-procedure", operator: { kind: "human", id: "alice" } })
    });
    assert.equal(created.status, 201);
    const { change } = await created.json();
    const exercise = async () => {
      for (let request = 0; request < 12; request += 1) {
        const response = await fetch(url + "/api/projects/responsive/changes/" + change.id);
        assert.equal(response.status, 200);
        await response.json();
      }
    };
    await exercise();
    global.gc!();
    const heap = JSON.parse(await readFile(writeHeapSnapshot(${JSON.stringify(join(temporary, "heap.heapsnapshot"))}), "utf8"));
    const prefix = join(tmpdir(), "memsphere-change-detail-preview-");
    const retained = heap.strings.filter((value: string) => value.startsWith(prefix) && value.length > prefix.length);
    assert.deepEqual(retained, []);
    console.log("After 12 detail requests: retained disposable preview paths = 0");
  }, { includeBrokenMemory: false, initializeGit: true });
});
`);
  process.exitCode = await new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, ["--expose-gc", "--import", "tsx", program], { cwd: repository, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", code => resolveExit(code ?? 1));
  });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
