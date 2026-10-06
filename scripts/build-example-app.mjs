import { build } from "esbuild";
import { chmod } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const output = fileURLToPath(new URL("examples/apps/expense/cli/expense.cjs", root));
await build({ entryPoints: [fileURLToPath(new URL("examples/apps/expense/cli/source.mjs", root))], outfile: output,
  bundle: true, platform: "node", format: "cjs", target: "node22", external: ["fs-native-extensions"], define: { "import.meta.url": "__expense_import_meta_url" },
  banner: { js: "#!/usr/bin/env node\nconst __expense_import_meta_url = require('node:url').pathToFileURL(__filename).href;" },
  alias: { "memsphere/data/extensions": fileURLToPath(new URL("dist/data/extensions/index.js", root)), "memsphere/data": fileURLToPath(new URL("dist/data/index.js", root)) } });
await chmod(output, 0o755);
