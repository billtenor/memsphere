import { Command, Option } from "commander";
import { readConfig } from "../config.js";
import { createProjectModelHost } from "../project/models.js";
import { createBusinessStore, removeBusinessStore, getBusinessBinding, readBusinessProject, validateBusinessBindings, assertBusinessStoreId, serviceError } from "../project/business-stores.js";
import { assertModelRef } from "../project/model-registration-contract.js";
import { readModelOperationStamp, assertModelOperationStamp } from "../project/model-operation.js";
import { parseFilesystemDataStoreConfig } from "../data/extensions/filesystem-datastore/index.js";
import { Config } from "../data/api/config.js";
import { assertJsonDescriptor } from "../data/extensions/json-serializer/index.js";
import { compareStrings } from "../pagination.js";
import { savedResult, addCliOutput, registerResultAction, commandFacts, paginateCliItems } from "./output.js";
import { businessStoreListResult, businessStoreReadResult, businessStoreWriteResult } from "./business-output.js";
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

const output = addCliOutput;
export function registerDataStoreCommands(data: Command) {
  const store = data.command("store").description("Manage explicit business Store bindings");
  registerResultAction(output(store.command("list").option("--model <ref>").addOption(new Option("--kind <kind>").choices(["data", "value"]))
    .option("--limit <n>", "Page size, 1–1000; default 100").option("--cursor <token>")), async options => {
      const config = await readConfig(); const root = config.scopeRoot;
      const stamp = await readModelOperationStamp(root);
      const project = await readBusinessProject(root);
      await validateBusinessBindings(root, project);
      const host = await createProjectModelHost({}, { root, ...project });
      const models = new Map((await host.list()).map(model => [model.id, model]));
      const items = (await Promise.all(Object.entries(project.dataStores ?? {}).filter(([, binding]) => (!options.model || options.model === binding.model) && (!options.kind || options.kind === binding.kind))
        .map(async ([storeId, binding]) => {
          const { status, errorCode } = await boundModelStatus(host, binding, models.get(binding.model));
          return { storeId, model: binding.model, kind: binding.kind, factory: binding.factory, status, errorCode };
        })))
        .sort((a, b) => compareStrings(a.storeId, b.storeId));
      await assertModelOperationStamp(root, stamp);
      const page = paginateCliItems(items, options, { command: "data.store.list", scope: { root }, filters: { model: options.model, kind: options.kind } }, "established");
      return commandFacts(() => businessStoreListResult.parse({
        project: config.project?.name, items: page.items, nextCursor: page.nextCursor
      }));
    });
  registerResultAction(output(store.command("read <store-id>")), async (id, options) => {
      const config = await readConfig(); const state = await getBusinessBinding(config.scopeRoot, id);
      const host = await createProjectModelHost({}, { root: config.scopeRoot, ...state.project });
      const model = (await host.list()).find(model => model.id === state.binding.model);
      const value = state.binding.kind === "value";
      const extensions = state.binding.factory !== "memsphere/filesystem" ? undefined : parseFilesystemDataStoreConfig(new Config(state.binding.config)).extensions;
      const mapping = extensions ? Object.fromEntries([...new Set(extensions.map(([, mime]) => mime))]
        .map(mime => [mime, extensions.filter(([, type]) => type === mime).map(([suffix]) => suffix)])) : undefined;
      const stateOfModel = await boundModelStatus(host, state.binding, model);
      let { jsonValue } = stateOfModel;
      if (mapping && !Object.hasOwn(mapping, "application/json")) jsonValue = false;
      const { status, errorCode } = stateOfModel;
      await assertModelOperationStamp(config.scopeRoot, state.stamp);
      return commandFacts(() => businessStoreReadResult.parse({
        project: config.project?.name, storeId: id, model: state.binding.model,
        kind: state.binding.kind, factory: state.binding.factory, status, errorCode,
        idRule: value ? state.binding.factory === "memsphere/tos-json" ? "portable relative path; .json is a physical suffix" : "single portable record name; .json is a physical suffix" : state.binding.factory === "memsphere/tos" ? "portable relative path; no filename suffix required" : "portable relative path including a MIME-mapped suffix",
        capabilities: { value: jsonValue, payload: !value && status === "available", conditionalWrite: value && jsonValue || status === "available" && state.binding.factory === "memsphere/tos" && state.binding.config.mode === "revision", update: status === "available" && (value ? jsonValue : state.binding.factory !== "memsphere/tos" || state.binding.config.mode === "revision"), upsert: value && jsonValue, edit: value && jsonValue }, ...(mapping ? { contentTypeExtensions: mapping } : {}) }));
    });
  registerResultAction(output(store.command("create <store-id>").requiredOption("--model <ref>")
    .addOption(new Option("--kind <kind>").choices(["data", "value"]).makeOptionMandatory())
    .requiredOption("--factory <id>").requiredOption("--config-file <path|->", "Config JSON; - reads stdin").option("--dry-run")), async (id, options) => {
      assertBusinessStoreId(id); assertModelRef(options.model);
      const expectedFactory = options.kind === "value" ? "memsphere/filesystem-json" : "memsphere/filesystem";
      if (options.factory !== expectedFactory && !(options.kind === "data" && options.factory === "memsphere/tos") && !(options.kind === "value" && options.factory === "memsphere/tos-json")) throw serviceError("UNSUPPORTED_CAPABILITY", `Store kind ${options.kind} requires Factory ${expectedFactory}`);
      const config = await readConfig();
      const input = parseJsonInput(await readInputText(options.configFile));
      const result = await createBusinessStore({}, config.scopeRoot, id, { model: options.model, kind: options.kind, factory: options.factory, config: input }, options.dryRun);
      const { model, kind, factory } = result.binding;
      return commandFacts(() => businessStoreWriteResult.parse({
        project: config.project?.name, storeId: id, operation: result.operation, model, kind, factory,
        pendingCleanup: "pendingCleanup" in result && result.pendingCleanup === true ? true : undefined,
        dryRun: "dryRun" in result && result.dryRun === true ? true : undefined
      }), { saved: options.dryRun ? undefined : savedResult(id, ["data", "store", "read", id], config.project?.name) });
    });
  registerResultAction(output(store.command("remove <store-id>").option("--dry-run")), async (id, options) => {
      const config = await readConfig();
      const result = await removeBusinessStore({}, config.scopeRoot, id, options.dryRun);
      return commandFacts(() => businessStoreWriteResult.parse({
        project: config.project?.name, storeId: id, operation: result.operation,
        dataRetained: result.dataRetained, dryRun: result.dryRun
      }), { saved: options.dryRun ? undefined : savedResult(id, ["data", "store", "list"], config.project?.name) });
    });
}
