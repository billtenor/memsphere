import { resolve } from "node:path";
import { runPackagedCliSmoke } from "../../test/packaged-cli/windows-package-smoke.mjs";

if (process.platform !== "win32") throw new Error("windows-package-smoke must run on Windows");

const workspace = process.cwd();
const cli = resolve(workspace, ".ci-install", "node_modules", ".bin", "memsphere.cmd");
await runPackagedCliSmoke(workspace, cli);
