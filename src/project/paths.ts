import { resolve } from "node:path";
import type { ProjectPaths } from "./model.js";

export function projectPaths(root: string): ProjectPaths {
  const absolute = resolve(root);
  return {
    root: absolute,
    manifestPath: resolve(absolute, "project.json"),
    configPath: resolve(absolute, "config.json"),
    memoryRoot: resolve(absolute, "memory"),
    changesRoot: resolve(absolute, "changes"),
    runsRoot: resolve(absolute, "runs"),
    archiveRoot: resolve(absolute, "archives"),
    evalsRoot: resolve(absolute, "evals"),
    runtimeRoot: resolve(absolute, ".runtime")
  };
}
