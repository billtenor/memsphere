import { Command, Option } from "commander";
import { z } from "zod";
import { resolveProjectContext } from "../project/resolver.js";
import { AppError } from "../app/contracts.js";
import { readJson } from "../app/files.js";
import { checkApp, configureApp, installApp, setAppEnabled } from "../app/install.js";
import { readAppState, requireApp } from "../app/state.js";
import { AppMemoryProvider } from "../app/memory-provider.js";
import { DefaultMemoryCatalog } from "../memory/catalog.js";
import { bindCli, checkCli, listClis, registerCli, showCli } from "../tools/registry.js";

type Output = { output?: "text" | "json" };
function command(parent: Command, name: string) {
  return parent.command(name).addOption(new Option("--output <format>", "output format").choices(["text", "json"]).default("text"));
}
async function output(options: Output, action: () => Promise<unknown>) {
  try {
    const result = await action();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const detail = { code: error instanceof AppError ? error.code : error instanceof z.ZodError ? "INVALID_DESCRIPTOR" : "APP_OPERATION_FAILED",
      message: error instanceof Error ? error.message : String(error), details: error instanceof AppError ? error.details : undefined };
    if (options.output === "json") console.log(JSON.stringify({ error: detail }));
    console.error(`${detail.code}: ${detail.message}`);
    process.exitCode = error instanceof z.ZodError || error instanceof SyntaxError ? 2 : 1;
  }
}
const context = () => resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
export function registerAppCommands(program: Command): void {
  const app = program.command("app").description("Install and compose Apps in the selected Project.");
  command(app, "install").argument("<directory>").option("--config <file>").action((directory, options: Output & { config?: string }) => output(options, async () =>
    installApp(await context(), directory, options.config ? await readJson(options.config) : {})));
  command(app, "list").action((options: Output) => output(options, async () => {
    const state = await readAppState((await context()).primary);
    return { apps: Object.values(state.installations).map(app => ({ id: app.manifest.id, name: app.manifest.name, version: app.manifest.version, enabled: app.enabled })), pending: state.operations };
  }));
  command(app, "show").argument("<id>").action((id, options: Output) => output(options, async () => {
    const project = (await context()).primary, app = requireApp(await readAppState(project), id);
    const catalog = new DefaultMemoryCatalog(new AppMemoryProvider(project.paths.root, project.memoryRoot));
    const page = await catalog.list();
    const memories = app.memories.map(memory => ({ ...memory, reference: page.memories.find(item => item.app?.id === id && item.app?.assetKey === memory.key)?.reference ?? memory.reference }));
    const agent = app.manifest.entrypoints.agent.map(reference => {
      const memory = app.memories.find(memory => memory.reference === reference);
      const current = memory ? memories.find(m => m.key === memory.key)?.reference ?? reference : reference;
      return { reference: current, command: ["memsphere", "--project", project.name, current.startsWith("procedures/") ? "run" : "memory",
        current.startsWith("procedures/") ? "start" : "read", current, ...(current.startsWith("procedures/") ? ["--name", "<run-name>"] : [])] };
    });
    return { id, name: app.manifest.name, version: app.manifest.version, enabled: app.enabled,
      description: app.manifest.description, assets: app.manifest.assets, memories,
      configuration: app.manifest.configuration, entrypoints: app.manifest.entrypoints,
      usage: { agent, view: app.manifest.entrypoints.view.map(entry => ({ instanceId: entry.instanceId,
        path: entry.path ? `/projects/${encodeURIComponent(project.name)}/modules/${encodeURIComponent(entry.instanceId)}${entry.path}` : undefined,
        instruction: entry.path ? "Open this path in the Memsphere View service" : "Select the Module in the Project navigation" })) },
      cli: await listClis(project, id), viewChangesRequireRestart: Boolean(app.manifest.entrypoints.view.length) };
  }));
  command(app, "configure").argument("<id>").requiredOption("--config <file>").action((id, options: Output & { config: string }) => output(options, async () =>
    configureApp(await context(), id, await readJson(options.config))));
  for (const enabled of [true, false]) command(app, enabled ? "enable" : "disable").argument("<id>").action((id, options: Output) => output(options, async () =>
    setAppEnabled(await context(), id, enabled)));
  command(app, "check").argument("<id>").action((id, options: Output) => output(options, async () => {
    const result = await checkApp((await context()).primary, id);
    if (result.status !== "available") process.exitCode = 1;
    return result;
  }));
  const cli = program.command("cli").description("Discover external tools and their Project/App invocation bindings.");
  command(cli, "register").argument("<descriptor-file>").action((file, options: Output) => output(options, async () => registerCli(await context(), file)));
  command(cli, "bind").argument("<id>").requiredOption("--binding <file>").option("--app <id>").action((id, options: Output & { binding: string; app?: string }) => output(options, async () => bindCli(await context(), id, options.binding, options.app)));
  command(cli, "list").option("--app <id>").action((options: Output & { app?: string }) => output(options, async () => listClis((await context()).primary, options.app)));
  command(cli, "show").argument("<id>").option("--app <id>").action((id, options: Output & { app?: string }) => output(options, async () => showCli((await context()).primary, id, options.app)));
  command(cli, "check").argument("<id>").option("--app <id>").action((id, options: Output & { app?: string }) => output(options, async () => {
    const result = await checkCli((await context()).primary, id, options.app);
    if (result.status !== "available") process.exitCode = 1;
    return result;
  }));
}
