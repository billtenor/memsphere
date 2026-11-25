import { writeCliChunk } from "../cli-transport.js";
import { z } from "zod";
import { encodeJsonChunks } from "../data/extensions/json-serializer/streaming.js";
import { Command, Option } from "commander";
import { readConfig } from "../config.js";
import { assertEtag } from "../data/extensions/tos-datastore/revision.js";
import { validateTosWriteOptions } from "../data/extensions/tos-datastore/write-policy.js";
import { getBusinessBinding, openBusinessStore, serviceError } from "../project/business-stores.js";
import { listData, readData, hasData, writeData, upsertData, deleteData, editData, validateData, exportData } from "../project/data-service.js";
import { addCliOutput, cliCommand, emitCliResult, renderCliResult, type CliFormat } from "./output.js";
import { dataExistsResult, dataPageResult, dataReadResult, dataWriteResult } from "./business-output.js";
import { assertInputOptions, readDataInput, readJsonInput, readInputText, parseJsonInput, parseRevision } from "./input.js";
import { registerDataStoreCommands } from "./data-store.js";

const output = addCliOutput;
const stored = (command: Command) => output(command.requiredOption("--store <store-id>", "Explicit business Store ID"));
const valueInput = (command: Command) => command.option("--value <json>", "JSON value").option("--value-file <path|->", "JSON file; - reads stdin");
export function registerDataCommands(program: Command) {
  const data = program.command("data").description("Read and write records in explicitly selected business Stores");
  registerDataStoreCommands(data);
  stored(data.command("list").option("--limit <n>", "Page size, 1–1000; default 100").option("--cursor <token>"))
    .action(async options => {
      const config = await readConfig();
      const page = await listData({}, config.scopeRoot, options.store, options);
      const items = page.items.map(item => ({ id: item.id }));
      emitCliResult("data list", dataPageResult, { project: config.project?.name, storeId: options.store,
        items, nextCursor: page.nextCursor }, { format: options.output });
    });
  stored(data.command("read <id>").option("--metadata-only", "Read metadata without decoding Payload").option("--path <path>", "Query within the JSON value using JSONPath (RFC 9535)"))
    .action(async (id, options) => {
      const config = await readConfig();
      const record = await readData({}, config.scopeRoot, options.store, id, options);
      const result = {
        project: config.project?.name, storeId: options.store, id: record.id, modelRef: record.modelRef,
        ...publicMetadata(record), ...("value" in record ? { value: record.value } : {})
      };
      const { binding } = await getBusinessBinding(config.scopeRoot, options.store);
      if (binding.factory === "memsphere/tos-json" && "value" in result) {
        await streamDataRead(result, options.output);
      } else emitCliResult("data read", dataReadResult, result, { format: options.output, contentField: "value" });
    });
  stored(data.command("has <id>"))
    .action(async (id, options) => {
      const config = await readConfig();
      const result = await hasData({}, config.scopeRoot, options.store, id);
      emitCliResult("data has", dataExistsResult, { project: config.project?.name, storeId: options.store,
        id: result.id, modelRef: result.modelRef, exists: result.exists }, { format: options.output });
    });
  for (const operation of ["create", "update"] as const) {
    const command = stored(valueInput(data.command(`${operation} <id>`)).option("--payload-file <path|->", "Raw bytes; DataStore only")
      .option("--content-type <mime>", "MIME for raw Payload input").option("--dry-run"));
    if (operation === "update") command.option("--expected-revision <revision>", "Require the current record revision");
    command.action(async (id, options) => {
      assertInputOptions(options); const expectedRevision = parseRevision(options.expectedRevision);
      const config = await readConfig();
      const { binding } = await getBusinessBinding(config.scopeRoot, options.store);
      if (binding.factory === "memsphere/tos") validateTosWriteOptions(binding.config.mode, operation, expectedRevision);
      else if (binding.factory === "memsphere/tos-json" && expectedRevision !== undefined) {
        try { assertEtag(expectedRevision); } catch { throw serviceError("INVALID_ARGUMENT", "Expected a single Store revision"); }
      }
      else if (expectedRevision !== undefined && binding.kind === "data") throw serviceError("UNSUPPORTED_CAPABILITY", "Store has no conditional-write capability");
      const input = await readDataInput(options, binding.kind === "data", binding.factory === "memsphere/tos-json");
      const result = await writeData({}, config.scopeRoot, options.store, id, operation, input, { expectedRevision, dryRun: options.dryRun });
      emitDataWrite("data " + operation, config.project?.name, options.store, result, options.output);
    });
  }
  stored(valueInput(data.command("upsert <id>")).option("--dry-run"))
    .action(async (id, options) => {
      assertInputOptions(options, false);
      const config = await readConfig(); const { binding } = await getBusinessBinding(config.scopeRoot, options.store);
      const input = await readDataInput(options, false, binding.factory === "memsphere/tos-json");
      const result = await upsertData({}, config.scopeRoot, options.store, id, input, { dryRun: options.dryRun });
      emitDataWrite("data upsert", config.project?.name, options.store, result, options.output);
    });
  stored(data.command("delete <id>").option("--expected-revision <revision>").option("--dry-run"))
    .action(async (id, options) => { const expectedRevision = parseRevision(options.expectedRevision); const config = await readConfig();
      const result = await deleteData({}, config.scopeRoot, options.store, id, { expectedRevision, dryRun: options.dryRun });
      emitDataWrite("data delete", config.project?.name, options.store, result, options.output);
    });
  stored(data.command("edit <id>").option("--patch <json>", "RFC 6902 operations with JSON Pointer path/from")
    .option("--patch-file <path|->", "JSON Patch file; - reads stdin").option("--expected-revision <revision>").option("--dry-run"))
    .action(async (id, options) => {
      if ((options.patch === undefined) === (options.patchFile === undefined)) throw serviceError("INVALID_ARGUMENT", "Provide exactly one patch or patch-file");
      const expectedRevision = parseRevision(options.expectedRevision); const config = await readConfig();
      const opened = await openBusinessStore({}, config.scopeRoot, options.store);
      if (opened.store.kind !== "ValueStore") throw serviceError("UNSUPPORTED_CAPABILITY", "edit requires a conditional-write ValueStore");
      const patch = options.patch !== undefined ? parseJsonInput(options.patch) : opened.binding.factory === "memsphere/tos-json" ? await readJsonInput(options.patchFile) : parseJsonInput(await readInputText(options.patchFile));
      const result = await editData({}, config.scopeRoot, options.store, id, patch, { expectedRevision, dryRun: options.dryRun });
      emitDataWrite("data edit", config.project?.name, options.store, result, options.output);
    });
  stored(data.command("export <id>").addOption(new Option("--as <format>").choices(["payload", "json"]).makeOptionMandatory())
    .requiredOption("--out <path|->", "Exclusive file target or raw stdout (-)"))
    .action(async (id, options) => {
      if (options.out === "-" && options.output === "json") throw serviceError("INVALID_ARGUMENT", "Raw stdout export and JSON receipt are mutually exclusive");
      const config = await readConfig(); const result = await exportData({}, config.scopeRoot, options.store, id, options.as, options.out);
      if (result) emitDataWrite("data export", config.project?.name, options.store, result, options.output);
    });
  output(valueInput(data.command("validate [id]")).option("--store <store-id>").option("--model <ref>"))
    .action(async (id, options) => {
      const hasValue = options.value !== undefined || options.valueFile !== undefined;
      if (options.model === undefined ? id === undefined || options.store === undefined || hasValue : id !== undefined || options.store !== undefined || !hasValue)
        throw serviceError("INVALID_ARGUMENT", "Use id+store for existing data, or model+value for a candidate");
      if (hasValue) assertInputOptions(options, false);
      const config = await readConfig(); const input = hasValue ? await readDataInput(options, false) : undefined;
      const result = await validateData({}, config.scopeRoot, { id, storeId: options.store, modelRef: options.model,
        hasValue, value: input?.kind === "value" ? input.value : undefined });
      emitDataWrite("data validate", config.project?.name, options.store, result, options.output);
    });
}

type Metadata = { revision?: string; contentType?: string; createdAt?: number; updatedAt?: number; deleted?: boolean };
function publicMetadata({ revision, contentType, createdAt, updatedAt, deleted }: Metadata): Metadata {
  return { revision, contentType, createdAt, updatedAt, deleted };
}

function emitDataWrite(
  command: string, project: string | undefined, storeId: string | undefined,
  result: z.input<typeof dataWriteResult>, format?: CliFormat
) {
  const { id, modelRef, operation, dryRun, expectedRevision, out, bytes, valid } = result;
  const saved = id && storeId && !dryRun && valid === undefined && result.deleted !== false && {
    id,
    inspect: cliCommand([...(project ? ["--project", project] : []),
      "data", command === "data delete" ? "has" : "read", id, "--store", storeId,
      ...(command === "data delete" ? [] : ["--metadata-only"]), "--output", "json"])
  };
  emitCliResult(command, dataWriteResult, {
    project, storeId, id, modelRef, operation, ...publicMetadata(result), dryRun, expectedRevision, out, bytes, valid
  }, { format, saved: saved || undefined });
}

async function streamDataRead(value: z.input<typeof dataReadResult>, format?: CliFormat) {
  const result = dataReadResult.parse(value);
  const { value: body, ...metadata } = result;
  const prefix = format === "json" ? undefined : renderCliResult("data read", dataReadResult,
    { ...metadata, value: "" }, { contentField: "value", contentStream: true });
  const envelope = Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
  const stream = encodeJsonChunks({}, format === "json" ? envelope : body);
  let first = true;
  for await (const chunk of stream) {
    if (first && prefix) await writeCliChunk(prefix);
    first = false;
    await writeCliChunk(chunk);
  }
}
