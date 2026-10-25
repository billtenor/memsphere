import { realpath } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const packageRoot = dirname(fileURLToPath(import.meta.url));
const executable = option("--cli", execFileSync("which", ["memsphere"], { encoding: "utf8" }).trim());
const dist = dirname(await realpath(executable));
const { readProjectConfig } = await import(pathToFileURL(resolve(dist, "config.js")).href);
const { createViewServer } = await import(pathToFileURL(resolve(dist, "commands/view.js")).href);
const project = option("--project", "memsphere");
const port = Number(option("--port", "30025"));
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid preview port");
const config = await readProjectConfig(project);
const moduleId = "org.memsphere.context-control.prototype";
const instanceId = "context-control-prototype";
config.view = { ...config.view, host: "0.0.0.0", port };
config.viewPackages = {
  ...config.viewPackages,
  installed: [...(config.viewPackages?.installed ?? []).filter(p => p.path !== packageRoot), { path: packageRoot }]
};
config.viewComposition = {
  ...config.viewComposition,
  packages: [...(config.viewComposition?.packages ?? []).filter(p => p.id !== moduleId), { id: moduleId, version: "0.1.0", enabled: true, instance_id: instanceId }]
};
// Use the installed, real View Shell. Composition exists only in this process;
// neither Home settings nor real Run / Artifact data are modified by the demo.
const server = createViewServer(config);
server.on("error", error => { console.error(error.message); process.exitCode = 1; });
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "0.0.0.0", resolve); });
console.log(`Prototype: http://localhost:${port}/projects/${encodeURIComponent(project)}/modules/${instanceId}`);
console.log("Real View Shell, fixed demonstration data; no production workflow is implemented by this prototype.");
const stop = () => server.close(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
