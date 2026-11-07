import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { reportExecutionProbeRelativePath, resolveReportExecutionProbePath } from "../src/report-execution.js";


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
