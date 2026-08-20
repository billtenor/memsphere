import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertReportExecutionCapability,
  reportExecutionProbeRelativePath,
  resolveReportExecutionProbePath
} from "../src/report-execution.js";

test("Report execution probe resolves Linux runtime directories", async () => {
  assert.equal(
    await resolveReportExecutionProbePath({
      platform: "linux",
      env: { XDG_RUNTIME_DIR: "/run/custom-user" },
      uid: 42
    }),
    join("/run/custom-user", reportExecutionProbeRelativePath)
  );
  assert.equal(
    await resolveReportExecutionProbePath({
      platform: "linux",
      env: {},
      uid: 42
    }),
    join("/run/user/42", reportExecutionProbeRelativePath)
  );
});

test("Report execution probe resolves the macOS user cache directory", async () => {
  assert.equal(
    await resolveReportExecutionProbePath({
      platform: "darwin",
      resolveDarwinCacheDirectory: async () => "/var/folders/user/C/"
    }),
    join("/var/folders/user/C", reportExecutionProbeRelativePath)
  );
  await assert.rejects(
    resolveReportExecutionProbePath({
      platform: "darwin",
      resolveDarwinCacheDirectory: async () => ""
    }),
    /platform runtime directory is not an absolute path/
  );
});

test("Report execution probe resolves the Windows local application data directory", async () => {
  assert.equal(
    await resolveReportExecutionProbePath({
      platform: "win32",
      env: { LOCALAPPDATA: "/windows/local" },
      resolveHomeDirectory: () => "/windows/home"
    }),
    join("/windows/local", reportExecutionProbeRelativePath)
  );
  assert.equal(
    await resolveReportExecutionProbePath({
      platform: "win32",
      env: {},
      resolveHomeDirectory: () => "/windows/home"
    }),
    join("/windows/home", "AppData", "Local", reportExecutionProbeRelativePath)
  );
});

test("Report execution probe rejects unsupported platforms", async () => {
  await assert.rejects(
    resolveReportExecutionProbePath({ platform: "aix" }),
    /unsupported operating system: aix/
  );
});

test("Report execution capability reuses one stable probe file", async () => {
  const root = await mkdtemp(join(tmpdir(), "memsphere-report-probe-"));
  try {
    const options = {
      platform: "linux" as const,
      env: { XDG_RUNTIME_DIR: root },
      uid: 42
    };
    const probePath = await assertReportExecutionCapability(options);
    await writeFile(probePath, "stable probe\n", "utf8");
    assert.equal(await assertReportExecutionCapability(options), probePath);
    assert.equal(await readFile(probePath, "utf8"), "stable probe\n");
    assert.deepEqual(await readdir(join(root, "memsphere")), ["report-execution.probe"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Report execution capability rejects invalid and non-file probe paths", async () => {
  const invalidParentRoot = await mkdtemp(join(tmpdir(), "memsphere-report-invalid-parent-"));
  const nonFileRoot = await mkdtemp(join(tmpdir(), "memsphere-report-non-file-"));
  try {
    await writeFile(join(invalidParentRoot, "memsphere"), "not a directory", "utf8");
    await assert.rejects(
      assertReportExecutionCapability({
        platform: "linux",
        env: { XDG_RUNTIME_DIR: invalidParentRoot },
        uid: 42
      }),
      (error: NodeJS.ErrnoException) =>
        error.code === "EEXIST"
        && error.syscall === "mkdir"
        && error.message.includes(join(invalidParentRoot, "memsphere"))
    );

    await mkdir(join(nonFileRoot, reportExecutionProbeRelativePath), { recursive: true });
    await assert.rejects(
      assertReportExecutionCapability({
        platform: "linux",
        env: { XDG_RUNTIME_DIR: nonFileRoot },
        uid: 42
      }),
      /probe path exists but is not a regular file/
    );
  } finally {
    await rm(invalidParentRoot, { recursive: true, force: true });
    await rm(nonFileRoot, { recursive: true, force: true });
  }
});
