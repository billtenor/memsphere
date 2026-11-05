#!/usr/bin/env node
import * as nodeModule from "node:module";

// Cache compiled JavaScript only; Node validates source content before reuse.
// Earlier Node 22 releases and disabled/unwritable caches keep normal startup.
nodeModule.enableCompileCache?.();
await import("./cli-program.js");
