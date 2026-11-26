import type { ProjectModelSummary } from "../project/models.js";
import { Command, Option } from "commander";
import { readConfig } from "../config.js";
import { listModels, readModel, mutateModel, validateModel, assertWritableModelRef, type ModelManagementFields } from "../project/model-service.js";
import { assertModelRef } from "../project/model-registration-contract.js";
import { serviceError } from "../project/business-stores.js";
import { savedResult, addCliOutput, cliPageBudget, publishResult } from "./output.js";
import { modelLabel, modelListResult, modelReadResult, modelValidationResult, modelWriteResult, publicRegistration } from "./business-output.js";
import { readInputText } from "./input.js";

const collect = (value: string, previous: string[] = []) => [...previous, value];
const output = addCliOutput;
function management(command: Command) {
  return command.option("--name <text>", "Display name").option("--description <text>", "Description")
    .option("--package <id>", "Package ID").option("--package-name <text>", "Package display name")
    .option("--tag <tag>", "Replace tags; repeat for multiple tags", collect).option("--dry-run", "Check without changing files");
}
function fields(options: Record<string, unknown>): ModelManagementFields {
  return Object.fromEntries([...["name", "description", "package"].filter(key => options[key] !== undefined).map(key => [key, options[key]]),
    ...(options.packageName === undefined ? [] : [["package_name", options.packageName]]), ...(options.tag === undefined ? [] : [["tags", options.tag]])]) as ModelManagementFields;
}
function modelSummary(item: ProjectModelSummary) {
  return {
    id: item.id, title: modelLabel(item.title), name: modelLabel(item.registration?.name),
    origin: item.origin, status: item.status, errorCode: item.errorCode
  };
}

export function registerModelCommands(program: Command) {
  const model = program.command("model").description("Manage model definitions and registration");
  output(model.command("list").description("List models, filtering before pagination")
    .addOption(new Option("--origin <origin>").choices(["project", "system", "market"]))
    .option("--package <id>").option("--unpackaged").option("--tag <tag>", "Require tag (repeatable)", collect)
    .option("--query <text>").addOption(new Option("--status <status>").choices(["available", "unavailable"]))
    .option("--limit <n>", "Page size, 1–1000; default 100").option("--cursor <token>", "Continuation cursor"))
    .action(async options => {
      const config = await readConfig();
      const page = await listModels({}, config.scopeRoot, options, options, cliPageBudget("established", modelSummary));
      const items = page.items.map(modelSummary);
      publishResult("model list", () => modelListResult.parse({ project: config.project?.name, items, nextCursor: page.nextCursor }), { format: options.output });
    });
  output(model.command("read <model-ref>").description("Read a model without writing files")
    .addOption(new Option("--part <part>", "Model content").choices(["all", "registration", "definition"]).default("definition")))
    .action(async (ref, options) => {
      const config = await readConfig();
      const result = await readModel({}, config.scopeRoot, ref, options.part);
      publishResult("model read", () => modelReadResult.parse({
        project: config.project?.name, modelRef: result.modelRef, origin: result.origin,
        registration: result.registration && publicRegistration(result.registration), definition: result.definition
      }), { format: options.output, contentField: "definition" });
    });
  for (const operation of ["create", "update"] as const) {
    const command = management(model.command(`${operation} <model-ref>`).description(`${operation} a project or imported model`));
    if (operation === "create") command.requiredOption("--definition-file <path|->", "Definition JSON; - reads stdin");
    else command.option("--definition-file <path|->", "Replacement definition JSON; - reads stdin").option("--unset <field>", "Remove registration field (repeatable)", collect);
    output(command).action(async (ref, options) => {
      assertWritableModelRef(ref);
      const config = await readConfig();
      const source = options.definitionFile === undefined ? undefined : await readInputText(options.definitionFile);
      const result = await mutateModel({}, config.scopeRoot, operation, ref, { source, fields: fields(options), unset: options.unset, dryRun: options.dryRun });
      publishResult("model " + operation, () => modelWriteResult.parse({
        project: config.project?.name, operation: result.operation, modelRef: result.modelRef,
        registration: result.registration && publicRegistration(result.registration), dryRun: result.dryRun ? true : undefined
      }), { format: options.output, saved: options.dryRun ? undefined : savedResult(ref, ["model", "read", ref, "--part", "registration"], config.project?.name) });
    });
  }
  output(model.command("delete <model-ref>").description("Delete an unused writable model").option("--dry-run"))
    .action(async (ref, options) => {
      const config = await readConfig();
      const result = await mutateModel({}, config.scopeRoot, "delete", ref, { dryRun: options.dryRun });
      publishResult("model delete", () => modelWriteResult.parse({
        project: config.project?.name, operation: result.operation, modelRef: result.modelRef,
        dryRun: result.dryRun ? true : undefined
      }), { format: options.output, saved: options.dryRun ? undefined : savedResult(ref, ["model", "list", "--query", ref], config.project?.name) });
    });
  output(model.command("validate <model-ref>").description("Validate saved or candidate definition without saving")
    .option("--definition-file <path|->", "Candidate definition JSON; - reads stdin")
    .addOption(new Option("--check <check>").choices(["definition", "runtime"]).default("runtime"))
    .option("--check-data", "Validate data in bound business Stores").option("--store <id>", "Restrict data checks (repeatable)", collect))
    .action(async (ref, options) => { assertModelRef(ref);
      if (options.store?.length && !options.checkData || options.checkData && options.check === "definition") throw serviceError("INVALID_ARGUMENT", "store requires check-data; check-data requires runtime");
      const config = await readConfig();
      const source = options.definitionFile === undefined ? undefined : await readInputText(options.definitionFile);
      const result = await validateModel({}, config.scopeRoot, ref, { source, check: options.check, checkData: options.checkData, stores: options.store });
      publishResult("model validate", () => modelValidationResult.parse({
        project: config.project?.name, operation: result.operation, modelRef: result.modelRef,
        valid: result.valid, checks: result.checks, data: result.data?.map(({ storeId, checked }) => ({ storeId, checked }))
      }), { format: options.output });
    });
}
