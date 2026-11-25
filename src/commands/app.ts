import type { Command } from "commander";
import { z } from "zod";
import { listAppMemoryEntries } from "../app/ownership.js";
import { resolveProjectContext } from "../project/resolver.js";
import { readJson } from "../app/files.js";
import { checkApp, configureApp, installApp, setAppEnabled } from "../app/install.js";
import { appConfigurationRevision, readAppState, requireApp } from "../app/state.js";
import { AppMemoryProvider } from "../app/memory-provider.js";
import { DefaultMemoryCatalog } from "../memory/catalog.js";
import { bindCli, checkCli, listClis, registerCli, showCli } from "../tools/registry.js";
import { addCliOutput, cliCommand, emitCliResult, paginateCliItems, previewText } from "./output.js";
import { cliCommandSchema, nextAction } from "../prompts/cli-output.js";
import { type PaginationOptions } from "../pagination.js";

const context = () => resolveProjectContext({ project: process.env.MEMSPHERE_PROJECT });
const string = z.string();
const optionalString = string.optional();
const appSummary = z.object({ id: string, name: string, version: string, enabled: z.boolean() }).strict();
const installResult = z.object({ id: string, status: string, version: optionalString, enabled: z.boolean(), nextAction }).strict();
const appPage = z.object({ apps: z.array(appSummary), pendingCount: z.number().int().nonnegative(), nextCursor: optionalString }).strict();
const cliSummary = z.object({ id: string, status: string, apps: z.array(string) }).strict();
const cliPage = z.object({ items: z.array(cliSummary), nextCursor: optionalString }).strict();
const cliDetail = cliSummary.extend({
  project: string, app: optionalString,
  invocation: z.object({ executable: string, args: z.array(string), cwd: optionalString }).strict().optional()
}).strict();
const appDetail = appSummary.extend({
  revision: string, configuration: optionalString, description: optionalString, descriptionTruncated: z.boolean().optional(),
  usage: z.object({
    agent: z.array(z.object({ reference: string, action: cliCommandSchema }).strict()),
    view: z.array(z.object({ instanceId: string, path: optionalString }).strict())
  }).strict(),
  projectStores: z.array(z.object({ key: string, model: string, kind: string, storeId: string.nullable() }).strict()),
  viewChangesRequireRestart: z.boolean()
}).strict();
const configureResult = z.object({ id: string, status: string, revision: string, restartRequired: z.boolean(), nextAction }).strict();
const enableResult = z.object({ id: string, enabled: z.boolean(), restartRequired: z.boolean(), nextAction }).strict();
const checkResult = z.object({
  id: string, app: optionalString, status: string,
  items: z.array(z.object({ name: string, status: string }).strict()), total: z.number().int().nonnegative()
}).strict();
const registrationResult = z.object({ id: string, project: optionalString, app: optionalString, status: string }).strict();

function command(parent: Command, name: string) {
  return addCliOutput(parent.command(name));
}

function listOptions(command: Command) {
  return command.option("--limit <n>", "maximum results in one page").option("--cursor <token>", "continuation cursor");
}

function restartAction(restartRequired: boolean) {
  return restartRequired ? cliCommand(["view", "restart"]) : undefined;
}

export function registerAppCommands(program: Command): void {
  const app = program.command("app").description("Install and compose Apps in the selected Project.");
  command(app, "install").argument("<directory>").option("--config <file>").action(async (directory, options: { config?: string }) => {
    const target = await context();
    const result = await installApp(target, directory, options.config ? await readJson(options.config) : {});
    const inspect = cliCommand(["--project", target.primary.name, "app", "show", result.id]);
    const nextAction = !result.enabled && !("diagnostic" in result)
      ? cliCommand(["--project", target.primary.name, "app", "enable", result.id]) : inspect;
    emitCliResult("app install", installResult, {
      id: result.id, status: result.status, version: "version" in result ? result.version : undefined,
      enabled: result.enabled, nextAction
    }, { saved: { id: result.id, inspect } });
  });
  listOptions(command(app, "list")).action(async (options: PaginationOptions) => {
    const { primary } = await context();
    const state = await readAppState(primary);
    const items = Object.values(state.installations).map(({ manifest, enabled }) => ({
      id: manifest.id, name: previewText(manifest.name, 160).text, version: manifest.version, enabled
    })).sort((a, b) => a.id.localeCompare(b.id));
    const page = paginateCliItems(items, { limit: options.limit, cursor: options.cursor },
      { command: "app.list", scope: { project: primary.name } }, "summary");
    emitCliResult("app list", appPage, { apps: page.items, nextCursor: page.nextCursor, pendingCount: Object.keys(state.operations).length },
      { itemsField: "apps", maximumBytes: options.limit === undefined ? 32768 : 131072 });
  });
  command(app, "show").argument("<id>").action(async (id) => {
    const { primary: project } = await context();
    const app = requireApp(await readAppState(project), id);
    const catalog = new DefaultMemoryCatalog(new AppMemoryProvider(project.paths.root, project.memoryRoot));
    const entries = await listAppMemoryEntries(catalog);
    const agent = app.manifest.entrypoints.agent.map(reference => {
      const memory = app.memories.find(memory => memory.reference === reference);
      const current = memory ? entries.find(item => item.app?.id === id && item.app?.assetKey === memory.key)?.reference ?? reference : reference;
      const procedure = current.startsWith("procedures/");
      const args = ["--project", project.name, ...(procedure ? ["run", "start", current, "--name", "<run-name>"] : ["memory", "read", current])];
      return { reference: current, action: cliCommand(args) };
    });
    const description = app.manifest.description === undefined ? undefined : previewText(app.manifest.description, 256);
    emitCliResult("app show", appDetail, {
      id, name: previewText(app.manifest.name, 160).text, version: app.manifest.version, enabled: app.enabled,
      description: description?.text, descriptionTruncated: description?.truncated,
      revision: appConfigurationRevision(app), configuration: app.manifest.configuration,
      projectStores: app.manifest.projectStores.map(store => {
        const value = app.config[store.configKey];
        return { key: store.key, model: store.model, kind: store.kind, storeId: typeof value === "string" ? value : null };
      }),
      usage: { agent, view: app.manifest.entrypoints.view.map(entry => ({
        instanceId: entry.instanceId,
        path: entry.path ? `/projects/${encodeURIComponent(project.name)}/modules/${encodeURIComponent(entry.instanceId)}${entry.path}` : undefined
      })) },
      viewChangesRequireRestart: app.manifest.entrypoints.view.length > 0
    });
  });
  command(app, "configure").argument("<id>").requiredOption("--config <file>").action(async (id, options: { config: string }) => {
    const { status, revision, restartRequired } = await configureApp(await context(), id, await readJson(options.config));
    emitCliResult("app configure", configureResult, { id, status, revision, restartRequired, nextAction: restartAction(restartRequired) });
  });
  for (const enabled of [true, false]) {
    const operation = enabled ? "enable" : "disable";
    command(app, operation).argument("<id>").action(async (id) => {
      const result = await setAppEnabled(await context(), id, enabled);
      emitCliResult("app " + operation, enableResult, { id, enabled: result.enabled, restartRequired: result.restartRequired,
        nextAction: restartAction(result.restartRequired) });
    });
  }
  command(app, "check").argument("<id>").action(async (id) => {
    const result = await checkApp((await context()).primary, id);
    const items = result.items.slice(0, 10).map(item => ({ name: previewText(item.name, 160).text, status: item.available ? "available" : "unavailable" }));
    emitCliResult("app check", checkResult, { id, status: result.status, items, total: result.items.length });
    if (result.status !== "available") process.exitCode = 1;
  });

  const cli = program.command("cli").description("Discover external tools and their Project/App invocation bindings.");
  command(cli, "register").argument("<descriptor-file>").action(async (file) => {
    const { id, status } = await registerCli(await context(), file);
    emitCliResult("cli register", registrationResult, { id, status });
  });
  command(cli, "bind").argument("<id>").requiredOption("--binding <file>").option("--app <id>").action(async (id, options: { app?: string; binding: string }) => {
    const result = await bindCli(await context(), id, options.binding, options.app);
    emitCliResult("cli bind", registrationResult, { id: result.id, project: result.project, app: result.app, status: result.status });
  });
  listOptions(command(cli, "list").option("--app <id>")).action(async (options: PaginationOptions & { app?: string }) => {
    const { primary } = await context();
    const candidates = await listClis(primary, options.app);
    const items = candidates.map(entry => ({ id: entry.id, status: entry.status, apps: entry.apps ?? [] }));
    const page = paginateCliItems(items, { limit: options.limit, cursor: options.cursor },
      { command: "cli.list", scope: { project: primary.name }, filters: { app: options.app } }, "summary");
    emitCliResult("cli list", cliPage, page);
  });
  command(cli, "show").argument("<id>").option("--app <id>").action(async (id, options: { app?: string }) => {
    const result = await showCli((await context()).primary, id, options.app);
    const invocation = result.invocation;
    emitCliResult("cli show", cliDetail, {
      id: result.id, status: result.status, project: result.project, app: result.app, apps: result.apps,
      ...(invocation ? { invocation: { executable: invocation.executable, args: invocation.args, cwd: invocation.cwd } } : {})
    });
  });
  command(cli, "check").argument("<id>").option("--app <id>").action(async (id, options: { app?: string }) => {
    const result = await checkCli((await context()).primary, id, options.app);
    const items = result.items.slice(0, 10).map(({ name, status }) => ({ name: previewText(name, 160).text, status }));
    emitCliResult("cli check", checkResult, { id, app: result.app, status: result.status, items, total: result.items.length });
    if (result.status !== "available") process.exitCode = 1;
  });
}
