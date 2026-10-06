import { Command, Option } from "commander";
import { readConfig } from "../config.js";
import { listModels, readModel, mutateModel, validateModel, assertWritableModelRef, type ModelManagementFields } from "../project/model-service.js";
import { assertModelRef } from "../project/model-registration-contract.js";
import { serviceError } from "../project/business-stores.js";
import { emitCommandResult } from "./cli-errors.js";
import { readInputText } from "./input.js";

const collect = (value: string, previous: string[] = []) => [...previous, value];
const output = (command: Command) => command.addOption(new Option("--output <format>", "Output format").choices(["text", "json"]).default("text"));
function management(command: Command) {
  return command.option("--name <text>", "Display name").option("--description <text>", "Description")
    .option("--package <id>", "Package ID").option("--package-name <text>", "Package display name")
    .option("--tag <tag>", "Replace tags; repeat for multiple tags", collect).option("--dry-run", "Check without changing files");
}
function fields(options: Record<string, unknown>): ModelManagementFields {
  return Object.fromEntries([...["name", "description", "package"].filter(key => options[key] !== undefined).map(key => [key, options[key]]),
    ...(options.packageName === undefined ? [] : [["package_name", options.packageName]]), ...(options.tag === undefined ? [] : [["tags", options.tag]])]) as ModelManagementFields;
}
export function registerModelCommands(program: Command) {
  const model = program.command("model").description("Manage model definitions and registration");
  output(model.command("list").description("List models, filtering before pagination")
    .addOption(new Option("--origin <origin>").choices(["project", "system", "market"]))
    .option("--package <id>").option("--unpackaged").option("--tag <tag>", "Require tag (repeatable)", collect)
    .option("--query <text>").addOption(new Option("--status <status>").choices(["available", "unavailable"]))
    .option("--limit <n>", "Page size, 1–1000; default 100").option("--cursor <token>", "Continuation cursor"))
    .action(async options => { const config = await readConfig(); emitCommandResult({ project: config.project?.name, ...await listModels({}, config.scopeRoot, options, options) }, options.output); });
  output(model.command("read <model-ref>").description("Read a model without writing files")
    .addOption(new Option("--part <part>", "Model content").choices(["all", "registration", "definition"]).default("definition")))
    .action(async (ref, options) => { const config = await readConfig(); emitCommandResult({ project: config.project?.name, ...await readModel({}, config.scopeRoot, ref, options.part) }, options.output); });
  for (const operation of ["create", "update"] as const) {
    const command = management(model.command(`${operation} <model-ref>`).description(`${operation} a project or imported model`));
    if (operation === "create") command.requiredOption("--definition-file <path|->", "Definition JSON; - reads stdin");
    else command.option("--definition-file <path|->", "Replacement definition JSON; - reads stdin").option("--unset <field>", "Remove registration field (repeatable)", collect);
    output(command).action(async (ref, options) => {
      assertWritableModelRef(ref);
      const config = await readConfig();
      const source = options.definitionFile === undefined ? undefined : await readInputText(options.definitionFile);
      emitCommandResult({ project: config.project?.name, ...await mutateModel({}, config.scopeRoot, operation, ref, { source, fields: fields(options), unset: options.unset, dryRun: options.dryRun }) }, options.output);
    });
  }
  output(model.command("delete <model-ref>").description("Delete an unused writable model").option("--dry-run"))
    .action(async (ref, options) => { const config = await readConfig(); emitCommandResult({ project: config.project?.name, ...await mutateModel({}, config.scopeRoot, "delete", ref, { dryRun: options.dryRun }) }, options.output); });
  output(model.command("validate <model-ref>").description("Validate saved or candidate definition without saving")
    .option("--definition-file <path|->", "Candidate definition JSON; - reads stdin")
    .addOption(new Option("--check <check>").choices(["definition", "runtime"]).default("runtime"))
    .option("--check-data", "Validate data in bound business Stores").option("--store <id>", "Restrict data checks (repeatable)", collect))
    .action(async (ref, options) => { assertModelRef(ref);
      if (options.store?.length && !options.checkData || options.checkData && options.check === "definition") throw serviceError("INVALID_ARGUMENT", "store requires check-data; check-data requires runtime");
      const config = await readConfig();
      const source = options.definitionFile === undefined ? undefined : await readInputText(options.definitionFile);
      emitCommandResult({ project: config.project?.name, ...await validateModel({}, config.scopeRoot, ref, { source, check: options.check, checkData: options.checkData, stores: options.store }) }, options.output);
    });
}
