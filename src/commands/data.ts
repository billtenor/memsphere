import { Command, Option } from "commander";
import { readConfig } from "../config.js";
import { openBusinessStore, serviceError } from "../project/business-stores.js";
import { listData, readData, hasData, writeData, deleteData, editData, validateData, exportData } from "../project/data-service.js";
import { emitCommandResult } from "./cli-errors.js";
import { assertInputOptions, readDataInput, readInputText, parseJsonInput, parseRevision } from "./input.js";
import { registerDataStoreCommands } from "./data-store.js";

const output = (command: Command) => command.addOption(new Option("--output <format>").choices(["text", "json"]).default("text"));
const stored = (command: Command) => output(command.requiredOption("--store <store-id>", "Explicit business Store ID"));
const valueInput = (command: Command) => command.option("--value <json>", "JSON value").option("--value-file <path|->", "JSON file; - reads stdin");
export function registerDataCommands(program: Command) {
  const data = program.command("data").description("Read and write records in explicitly selected business Stores");
  registerDataStoreCommands(data);
  stored(data.command("list").option("--limit <n>", "Page size, 1–1000; default 100").option("--cursor <token>"))
    .action(async options => { const config = await readConfig(); emitCommandResult({ project: config.project?.name, storeId: options.store, ...await listData({}, config.scopeRoot, options.store, options) }, options.output); });
  stored(data.command("read <id>").option("--metadata-only", "Read metadata without decoding Payload").option("--path <path>", "Query within the JSON value using JSONPath (RFC 9535)"))
    .action(async (id, options) => { const config = await readConfig(); emitCommandResult({ project: config.project?.name, storeId: options.store, ...await readData({}, config.scopeRoot, options.store, id, options) }, options.output); });
  stored(data.command("has <id>"))
    .action(async (id, options) => { const config = await readConfig(); emitCommandResult({ project: config.project?.name, storeId: options.store, ...await hasData({}, config.scopeRoot, options.store, id) }, options.output); });
  for (const operation of ["create", "update"] as const) {
    const command = stored(valueInput(data.command(`${operation} <id>`)).option("--payload-file <path|->", "Raw bytes; DataStore only")
      .option("--content-type <mime>", "MIME for raw Payload input").option("--dry-run"));
    if (operation === "update") command.option("--expected-revision <n>", "Require the current record revision");
    command.action(async (id, options) => {
      assertInputOptions(options); const expectedRevision = parseRevision(options.expectedRevision);
      const config = await readConfig(); const opened = await openBusinessStore({}, config.scopeRoot, options.store);
      if (expectedRevision !== undefined && opened.store.kind !== "ValueStore") throw serviceError("UNSUPPORTED_CAPABILITY", "Store has no conditional-write capability");
      const input = await readDataInput(options, opened.store.kind === "DataStore");
      emitCommandResult({ project: config.project?.name, storeId: options.store, ...await writeData({}, config.scopeRoot, options.store, id, operation, input, { expectedRevision, dryRun: options.dryRun }) }, options.output);
    });
  }
  stored(data.command("delete <id>").option("--expected-revision <n>").option("--dry-run"))
    .action(async (id, options) => { const expectedRevision = parseRevision(options.expectedRevision); const config = await readConfig();
      emitCommandResult({ project: config.project?.name, storeId: options.store, ...await deleteData({}, config.scopeRoot, options.store, id, { expectedRevision, dryRun: options.dryRun }) }, options.output);
    });
  stored(data.command("edit <id>").option("--patch <json>", "RFC 6902 operations with JSON Pointer path/from")
    .option("--patch-file <path|->", "JSON Patch file; - reads stdin").option("--expected-revision <n>").option("--dry-run"))
    .action(async (id, options) => {
      if ((options.patch === undefined) === (options.patchFile === undefined)) throw serviceError("INVALID_ARGUMENT", "Provide exactly one patch or patch-file");
      const expectedRevision = parseRevision(options.expectedRevision); const config = await readConfig();
      const opened = await openBusinessStore({}, config.scopeRoot, options.store);
      if (opened.store.kind !== "ValueStore") throw serviceError("UNSUPPORTED_CAPABILITY", "edit requires a conditional-write ValueStore");
      const patch = parseJsonInput(options.patch ?? await readInputText(options.patchFile));
      emitCommandResult({ project: config.project?.name, storeId: options.store, ...await editData({}, config.scopeRoot, options.store, id, patch, { expectedRevision, dryRun: options.dryRun }) }, options.output);
    });
  stored(data.command("export <id>").addOption(new Option("--as <format>").choices(["payload", "json"]).makeOptionMandatory())
    .requiredOption("--out <path|->", "Exclusive file target or raw stdout (-)"))
    .action(async (id, options) => {
      if (options.out === "-" && options.output === "json") throw serviceError("INVALID_ARGUMENT", "Raw stdout export and JSON receipt are mutually exclusive");
      const config = await readConfig(); const result = await exportData({}, config.scopeRoot, options.store, id, options.as, options.out);
      if (result) emitCommandResult({ project: config.project?.name, storeId: options.store, ...result }, options.output);
    });
  output(valueInput(data.command("validate [id]")).option("--store <store-id>").option("--model <ref>"))
    .action(async (id, options) => {
      const hasValue = options.value !== undefined || options.valueFile !== undefined;
      if (options.model === undefined ? id === undefined || options.store === undefined || hasValue : id !== undefined || options.store !== undefined || !hasValue)
        throw serviceError("INVALID_ARGUMENT", "Use id+store for existing data, or model+value for a candidate");
      if (hasValue) assertInputOptions(options, false);
      const config = await readConfig(); const input = hasValue ? await readDataInput(options, false) : undefined;
      emitCommandResult({ project: config.project?.name, ...(options.store ? { storeId: options.store } : {}), ...await validateData({}, config.scopeRoot, { id, storeId: options.store, modelRef: options.model, hasValue, value: input?.kind === "value" ? input.value : undefined }) }, options.output);
    });
}
