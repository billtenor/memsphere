import { build } from "esbuild";
import { chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const output = fileURLToPath(new URL("examples/apps/expense/cli/expense.cjs", root));
await build({ entryPoints: [fileURLToPath(new URL("examples/apps/expense/cli/source.mjs", root))], outfile: output,
  bundle: true, platform: "node", format: "cjs", target: "node20", banner: { js: "#!/usr/bin/env node" },
  alias: { "memsphere/data/extensions": fileURLToPath(new URL("dist/data/extensions/index.js", root)), "memsphere/data": fileURLToPath(new URL("dist/data/index.js", root)) } });
await chmod(output, 0o755);
