import type { Command } from "commander";
import { z } from "zod";
import { listAppMemoryEntries } from "../app/ownership.js";
import { resolveProjectContext } from "../project/resolver.js";
import { readJson } from "../app/files.js";
import { checkApp, configureApp, installApp, setAppEnabled } from "../app/install.js";
import { appConfigurationRevision, readAppState, requireApp } from "../app/state.js";
import { AppMemoryProvider } from "../app/memory-provider.js";
import { DefaultMemoryCatalog } from "../memory/catalog.js";
import { bindCli, checkCli, cliCheckNameSchema, listClis, registerCli, showCli } from "../tools/registry.js";
import { savedResult, addCliOutput, cliCommand, registerResultAction, commandFacts, paginateCliItems, previewText } from "./output.js";
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
  project: string, app: optionalString
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
const cliCheckResult = checkResult.extend({
  items: z.array(z.object({ name: cliCheckNameSchema, status: z.enum(["available", "unavailable", "unknown"]) }).strict())
});
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
  registerResultAction(command(app, "install").argument("<directory>").option("--config <file>"), async (directory, options: { config?: string }) => {
    const target = await context();
    const result = await installApp(target, directory, options.config ? await readJson(options.config) : {});
    const inspect = cliCommand(["--project", target.primary.name, "app", "show", result.id]);
    const nextAction = !result.enabled && !("diagnostic" in result)
      ? cliCommand(["--project", target.primary.name, "app", "enable", result.id]) : inspect;
    return commandFacts(() => installResult.parse({
      id: result.id, status: result.status, version: "version" in result ? result.version : undefined,
      enabled: result.enabled, nextAction
    }), { saved: { id: result.id, inspect } });
  });
  registerResultAction(listOptions(command(app, "list")), async (options: PaginationOptions) => {
    const { primary } = await context();
    const state = await readAppState(primary);
    const items = Object.values(state.installations).map(({ manifest, enabled }) => ({
      id: manifest.id, name: previewText(manifest.name, 160).text, version: manifest.version, enabled
    })).sort((a, b) => a.id.localeCompare(b.id));
    const page = paginateCliItems(items, { limit: options.limit, cursor: options.cursor },
      { command: "app.list", scope: { project: primary.name } }, "summary");
    return commandFacts(() => appPage.parse({ apps: page.items, nextCursor: page.nextCursor, pendingCount: Object.keys(state.operations).length }));
  });
  registerResultAction(command(app, "show").argument("<id>"), async (id) => {
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
    return commandFacts(() => appDetail.parse({
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
    }));
  });
  registerResultAction(command(app, "configure").argument("<id>").requiredOption("--config <file>"), async (id, options: { config: string }) => {
    const target = await context();
    const { status, revision, restartRequired } = await configureApp(target, id, await readJson(options.config));
    return commandFacts(() => configureResult.parse({ id, status, revision, restartRequired, nextAction: restartAction(restartRequired) }), { saved: savedResult(id, ["app", "show", id], target.primary.name) });
  });
  for (const enabled of [true, false]) {
    const operation = enabled ? "enable" : "disable";
    registerResultAction(command(app, operation).argument("<id>"), async (id) => {
      const target = await context();
      const result = await setAppEnabled(target, id, enabled);
      return commandFacts(() => enableResult.parse({ id, enabled: result.enabled, restartRequired: result.restartRequired,
        nextAction: restartAction(result.restartRequired) }), { saved: savedResult(id, ["app", "show", id], target.primary.name) });
    });
  }
  registerResultAction(command(app, "check").argument("<id>"), async (id) => {
    const result = await checkApp((await context()).primary, id);
    const items = result.items.slice(0, 10).map(item => ({ name: previewText(item.name, 160).text, status: item.available ? "available" : "unavailable" }));
    if (result.status !== "available") process.exitCode = 1;
    return commandFacts(() => checkResult.parse({ id, status: result.status, items, total: result.items.length }));
  });

  const cli = program.command("cli").description("Discover external tools and their Project/App invocation bindings.");
  registerResultAction(command(cli, "register").argument("<descriptor-file>"), async (file) => {
    const target = await context();
    const { id, status } = await registerCli(target, file);
    return commandFacts(() => registrationResult.parse({ id, status }), { saved: savedResult(id, ["cli", "show", id], target.primary.name) });
  });
  registerResultAction(command(cli, "bind").argument("<id>").requiredOption("--binding <file>").option("--app <id>"), async (id, options: { app?: string; binding: string }) => {
    const result = await bindCli(await context(), id, options.binding, options.app);
    return commandFacts(() => registrationResult.parse({ id: result.id, project: result.project, app: result.app, status: result.status }), { saved: savedResult(result.id, ["cli", "show", result.id, ...(result.app ? ["--app", result.app] : [])], result.project) });
  });
  registerResultAction(listOptions(command(cli, "list").option("--app <id>")), async (options: PaginationOptions & { app?: string }) => {
    const { primary } = await context();
    const candidates = await listClis(primary, options.app);
    const items = candidates.map(entry => ({ id: entry.id, status: entry.status, apps: entry.apps ?? [] }));
    const page = paginateCliItems(items, { limit: options.limit, cursor: options.cursor },
      { command: "cli.list", scope: { project: primary.name }, filters: { app: options.app } }, "summary");
    return commandFacts(() => cliPage.parse(page));
  });
  registerResultAction(command(cli, "show").argument("<id>").option("--app <id>"), async (id, options: { app?: string }) => {
    const result = await showCli((await context()).primary, id, options.app);
    return commandFacts(() => cliDetail.parse({
      id: result.id, status: result.status, project: result.project, app: result.app, apps: result.apps
    }));
  });
  registerResultAction(command(cli, "check").argument("<id>").option("--app <id>"), async (id, options: { app?: string }) => {
    const result = await checkCli((await context()).primary, id, options.app);
    const items = result.items.slice(0, 10).map(({ name, status }) => ({ name, status }));
    if (result.status !== "available") process.exitCode = 1;
    return commandFacts(() => cliCheckResult.parse({ id, app: result.app, status: result.status, items, total: result.items.length }));
  });
}
