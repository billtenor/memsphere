import { Command, Option } from "commander";
import { readConfig } from "../config.js";
import { createProjectModelHost } from "../project/models.js";
import { createBusinessStore, removeBusinessStore, getBusinessBinding, readBusinessProject, validateBusinessBindings, assertBusinessStoreId, serviceError } from "../project/business-stores.js";
import { assertModelRef } from "../project/model-registration-contract.js";
import { readModelOperationStamp, assertModelOperationStamp } from "../project/model-operation.js";
import { parseFilesystemDataStoreConfig } from "../data/extensions/filesystem-datastore/index.js";
import { Config } from "../data/api/config.js";
import { assertJsonDescriptor } from "../data/extensions/json-serializer/index.js";
import { paginateItems, compareStrings } from "../pagination.js";
import { emitCommandResult } from "./cli-errors.js";
import { readInputText, parseJsonInput } from "./input.js";
import type { BusinessStoreBinding } from "../project/model.js";
import type { ProjectModelSummary } from "../project/models.js";

async function boundModelStatus(host: Awaited<ReturnType<typeof createProjectModelHost>>, binding: BusinessStoreBinding, model?: ProjectModelSummary) {
  if (model?.status !== "available") return { status: "unavailable", jsonValue: false,
    error: model?.error ?? `Model not found: ${binding.model}`, errorCode: model?.errorCode ?? "MODEL_NOT_FOUND" };
  let jsonValue = true;
  try { assertJsonDescriptor((await host.runtime(binding.model)).descriptor.root); }
  catch (cause) {
    jsonValue = false;
    if (binding.kind === "value") return { status: "unavailable", jsonValue,
      errorCode: "STORE_INCOMPATIBLE", error: `filesystem JSON ValueStore requires a JSON-compatible model: ${String(cause)}` };
  }
  return { status: "available", jsonValue };
}

const output = (command: Command) => command.addOption(new Option("--output <format>").choices(["text", "json"]).default("text"));
export function registerDataStoreCommands(data: Command) {
  const store = data.command("store").description("Manage explicit business Store bindings");
  output(store.command("list").option("--model <ref>").addOption(new Option("--kind <kind>").choices(["data", "value"]))
    .option("--limit <n>", "Page size, 1–1000; default 100").option("--cursor <token>"))
    .action(async options => {
      const config = await readConfig(); const root = config.scopeRoot;
      const stamp = await readModelOperationStamp(root);
      const project = await readBusinessProject(root);
      const paths = await validateBusinessBindings(root, project);
      const host = await createProjectModelHost({}, { root, ...project });
      const models = new Map((await host.list()).map(model => [model.id, model]));
      const items = (await Promise.all(Object.entries(project.dataStores ?? {}).filter(([, binding]) => (!options.model || options.model === binding.model) && (!options.kind || options.kind === binding.kind))
        .map(async ([storeId, binding]) => {
          const { jsonValue: _jsonValue, ...status } = await boundModelStatus(host, binding, models.get(binding.model));
          return { storeId, ...binding, directory: paths.get(storeId), ...status };
        })))
        .sort((a, b) => compareStrings(a.storeId, b.storeId));
      await assertModelOperationStamp(root, stamp);
      emitCommandResult({ project: config.project?.name, ...paginateItems(items, options, { command: "data.store.list", scope: { root }, filters: { model: options.model, kind: options.kind } }) }, options.output);
    });
  output(store.command("read <store-id>"))
    .action(async (id, options) => {
      const config = await readConfig(); const state = await getBusinessBinding(config.scopeRoot, id);
      const host = await createProjectModelHost({}, { root: config.scopeRoot, ...state.project });
      const model = (await host.list()).find(model => model.id === state.binding.model);
      const value = state.binding.kind === "value";
      const extensions = value ? undefined : parseFilesystemDataStoreConfig(new Config(state.binding.config)).extensions;
      const mapping = extensions ? Object.fromEntries([...new Set(extensions.map(([, mime]) => mime))]
        .map(mime => [mime, extensions.filter(([, type]) => type === mime).map(([suffix]) => suffix)])) : undefined;
      const stateOfModel = await boundModelStatus(host, state.binding, model);
      let { jsonValue } = stateOfModel;
      if (!value && !Object.hasOwn(mapping!, "application/json")) jsonValue = false;
      const { jsonValue: _jsonValue, ...status } = stateOfModel;
      await assertModelOperationStamp(config.scopeRoot, state.stamp);
      emitCommandResult({ project: config.project?.name, storeId: id, ...state.binding, directory: state.directory,
        ...status,
        idRule: value ? "single portable record name; .json is a physical suffix" : "portable relative path including a MIME-mapped suffix",
        capabilities: { value: jsonValue, payload: !value && status.status === "available", conditionalWrite: value && jsonValue, edit: value && jsonValue }, ...(mapping ? { contentTypeExtensions: mapping } : {}) }, options.output);
    });
  output(store.command("create <store-id>").requiredOption("--model <ref>")
    .addOption(new Option("--kind <kind>").choices(["data", "value"]).makeOptionMandatory())
    .requiredOption("--factory <id>").requiredOption("--config-file <path|->", "Config JSON; - reads stdin").option("--dry-run"))
    .action(async (id, options) => {
      assertBusinessStoreId(id); assertModelRef(options.model);
      const expectedFactory = options.kind === "value" ? "memsphere/filesystem-json" : "memsphere/filesystem";
      if (options.factory !== expectedFactory) throw serviceError("UNSUPPORTED_CAPABILITY", `Store kind ${options.kind} requires Factory ${expectedFactory}`);
      const config = await readConfig();
      const input = parseJsonInput(await readInputText(options.configFile));
      emitCommandResult({ project: config.project?.name, ...await createBusinessStore({}, config.scopeRoot, id, { model: options.model, kind: options.kind, factory: options.factory, config: input }, options.dryRun) }, options.output);
    });
  output(store.command("remove <store-id>").option("--dry-run"))
    .action(async (id, options) => { const config = await readConfig(); emitCommandResult({ project: config.project?.name, ...await removeBusinessStore({}, config.scopeRoot, id, options.dryRun) }, options.output); });
}
