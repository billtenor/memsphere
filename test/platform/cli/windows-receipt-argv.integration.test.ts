import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatCliCommand } from "../../../src/prompts/cli-command.js";

test("CMD and the batch launcher preserve receipt arguments with delayed expansion on and off",
  { skip: process.platform !== "win32" }, async t => {
    const dir = await mkdtemp(join(tmpdir(), "memsphere cmd "));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const probe = join(dir, "probe.mjs");
    const codec = new URL("../../../dist/prompts/cli-command.js", import.meta.url).href;
    await writeFile(probe, `import { unpackCliArgv, cliShell } from ${JSON.stringify(codec)};
process.stdout.write(JSON.stringify({ args: unpackCliArgv(process.argv).slice(2), shell: cliShell() }));`);
    const shim = join(dir, "memsphere.cmd");
    await writeFile(shim, '@echo off\r\n"%TEST_NODE%" "%TEST_PROBE%" %*\r\n');
    const env = { ...process.env, TEST_NODE: process.execPath, TEST_PROBE: probe, MEMSPHERE_CLI: shim,
      PATH: dir + ";" + process.env.PATH, MSYSTEM: "", MEMSPHERE_CLI_SHELL: "" };
    const args = ["run", "start", "--name", 'A "quoted" & retained label', "100%PATH%", "!TEMP!", "folder name\\", "", "中文"];
    for (const delayed of ["on", "off"]) for (const launcher of ["memsphere", "reviewer"] as const) {
      const line = formatCliCommand({ kind: "command", launcher, args }, "cmd");
      const reply = spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/q", "/v:" + delayed], {
        input: line + "\r\nexit\r\n", encoding: "utf8", env, cwd: dir, timeout: 15000
      });
      assert.ifError(reply.error);
      assert.equal(reply.status, 0, reply.stderr);
      const start = reply.stdout.indexOf('{"args"');
      const end = reply.stdout.indexOf('}', start);
      assert.deepEqual(JSON.parse(reply.stdout.slice(start, end + 1)), { args, shell: "cmd" });
    }
  });
