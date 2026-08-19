import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { gitBashCandidates } from "../src/windows-prerequisites.js";

test("Git Bash candidates include locations derived from Git exec-path and Windows installation roots", () => {
  const candidates = gitBashCandidates("/opt/Git/mingw64/libexec/git-core", {
    ProgramFiles: "/program-files",
    LOCALAPPDATA: "/local-app-data"
  });
  assert(candidates.includes(resolve("/opt/Git/bin/bash.exe")));
  assert(candidates.includes(resolve(join("/program-files", "Git", "bin", "bash.exe"))));
  assert(candidates.includes(resolve(join("/local-app-data", "Programs", "Git", "usr", "bin", "bash.exe"))));
});
