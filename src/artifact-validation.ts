import { readFile } from "node:fs/promises";
import MarkdownIt from "markdown-it";
import { parse as parseYaml } from "yaml";
import type { ArtifactFormatSpec, ArtifactNode, SchemaField, SchemaNode } from "./memory/ast.js";
import { inferSchemaType, inheritSchemaFormat, resolveSchemaContract } from "./memory/schema.js";

export type ArtifactValidationStage = "type" | "format" | "schema";
export type ArtifactValidationStatus = "passed" | "failed" | "unsupported";

export type ArtifactValidationIssue = {
  code: string;
  stage: ArtifactValidationStage;
  validatorId: string;
  artifactPath: string;
  contractPath?: string;
  fieldPath?: string;
  actual?: unknown;
  expected?: unknown;
  message: string;
};

export type ArtifactValidationResult = {
  status: ArtifactValidationStatus;
  correctable: boolean;
  issues: ArtifactValidationIssue[];
};

export type CompiledArtifactContract = {
  name: string;
  type: string;
  format: ArtifactFormatSpec;
  schema?: string | SchemaNode;
  final: boolean;
};

export type ArtifactRepresentation =
  | { kind: "plain"; value: unknown }
  | { kind: "json" | "yaml"; value: unknown; decodeError?: string }
  | { kind: "markdown"; value: unknown; ast: readonly MarkdownToken[] };

export type PreparedArtifactCandidate = {
  source: Readonly<{ kind: "inline" | "file"; path?: string }>;
  raw: Uint8Array;
  text?: string;
  representation: Readonly<ArtifactRepresentation>;
};

export type ArtifactValidationContext = {
  runId: string;
  stepId: string;
  artifactPath: string;
  attemptId: string;
  contractPath?: string;
  fieldPath?: string;
  signal?: AbortSignal;
};

export type ArtifactValidationRequest = {
  contract: Readonly<CompiledArtifactContract>;
  candidate: Readonly<PreparedArtifactCandidate>;
  context: Readonly<ArtifactValidationContext>;
};

export interface ArtifactValidator {
  validate(request: ArtifactValidationRequest): ArtifactValidationResult | Promise<ArtifactValidationResult>;
}

export type ArtifactValidatorRegistration = {
  readonly id: string;
  readonly version: string;
  readonly stage: ArtifactValidationStage;
  readonly target: string;
  readonly validator: ArtifactValidator;
};

export type ArtifactValidationPlanEntry = Omit<ArtifactValidatorRegistration, "validator"> & {
  contractPath?: string;
};
export type ArtifactValidationPlan = readonly ArtifactValidationPlanEntry[];

export type ArtifactReportSource =
  | { kind: "inline"; value: string }
  | { kind: "file"; path: string };

type MarkdownToken = {
  type: string;
  tag: string;
  content: string;
  level: number;
  map?: [number, number] | null;
  children?: MarkdownToken[] | null;
};

export class ArtifactValidationFailure extends Error {
  readonly result: ArtifactValidationResult;

  constructor(result: ArtifactValidationResult) {
    super(result.issues.map((issue) => `${issue.code} at ${issue.artifactPath}${issue.fieldPath ? `.${issue.fieldPath}` : ""}: ${issue.message}`).join("\n"));
    this.name = "ArtifactValidationFailure";
    this.result = result;
  }
}

export class ArtifactValidatorRegistry {
  readonly #byStage = new Map<ArtifactValidationStage, Map<string, ArtifactValidatorRegistration[]>>();
  readonly #byId = new Map<string, ArtifactValidatorRegistration>();

  register(registration: ArtifactValidatorRegistration): this {
    if (!registration.id.trim()) throw new Error("Artifact validator id is required");
    if (!registration.version.trim()) throw new Error(`Artifact validator ${registration.id} version is required`);
    if (!registration.target.trim()) throw new Error(`Artifact validator ${registration.id} target is required`);
    if (this.#byId.has(registration.id)) throw new Error(`Duplicate Artifact validator id: ${registration.id}`);

    const targets = this.#byStage.get(registration.stage) ?? new Map<string, ArtifactValidatorRegistration[]>();
    const registrations = targets.get(registration.target) ?? [];
    registrations.push(registration);
    targets.set(registration.target, registrations);
    this.#byStage.set(registration.stage, targets);
    this.#byId.set(registration.id, registration);
    return this;
  }

  resolve(stage: ArtifactValidationStage, target: string): readonly ArtifactValidatorRegistration[] {
    return this.#byStage.get(stage)?.get(target) ?? [];
  }

  resolvePlan(contract: CompiledArtifactContract): ArtifactValidationPlan {
    const plan: ArtifactValidationPlanEntry[] = [];
    this.#appendPlanTarget(plan, "type", contract.type, "artifact");
    this.#appendPlanTarget(plan, "format", contract.format.name, "artifact");

    if (typeof contract.schema === "object") {
      this.#compileSchemaPlan(plan, contract.schema, contract, "schema", true);
    }
    return plan;
  }

  async execute(plan: ArtifactValidationPlan, request: ArtifactValidationRequest): Promise<ArtifactValidationResult> {
    if (!plan.some((entry) => entry.contractPath !== undefined)) {
      return this.#executeEntries(plan, request);
    }

    const root = await this.#executeEntries(plan.filter((entry) => entry.contractPath === "artifact"), {
      ...request,
      context: { ...request.context, contractPath: "artifact" }
    });
    if (root.status !== "passed") return root;
    if (typeof request.contract.schema !== "object") return root;

    return this.#executeSchemaNode(
      plan,
      request.contract.schema,
      request.contract,
      request.candidate,
      request.context,
      "schema",
      ""
    );
  }

  #appendPlanTarget(
    plan: ArtifactValidationPlanEntry[],
    stage: ArtifactValidationStage,
    target: string,
    contractPath: string
  ): void {
    const registrations = this.resolve(stage, target);
    if (!registrations.length) throw new Error(`Unsupported Artifact validation target: ${stage}:${target}`);
    plan.push(...registrations.map(({ id, version, stage: registeredStage, target: registeredTarget }) => ({
      id,
      version,
      stage: registeredStage,
      target: registeredTarget,
      contractPath
    })));
  }

  #compileSchemaPlan(
    plan: ArtifactValidationPlanEntry[],
    schema: SchemaNode,
    parent: CompiledArtifactContract,
    path: string,
    root: boolean
  ): void {
    const contract = schemaContract(schema, parent);
    if (root && !sameContractRepresentation(contract, parent)) {
      throw new Error("root Schema inferred type and effective format must match its Artifact contract");
    }
    this.#appendPlanTarget(plan, "type", contract.type, path);
    this.#appendPlanTarget(plan, "format", contract.format.name, path);
    if (
      (schema.fields?.length ?? 0) > 0 ||
      schema.item !== undefined ||
      (schema.items?.length ?? 0) > 0 ||
      (contract.format.name === "markdown" && contract.format.options.layout !== undefined)
    ) {
      this.#appendPlanTarget(plan, "schema", schemaTarget(contract), path);
    }

    for (const [index, field] of (schema.fields ?? []).entries()) {
      const fieldPath = `${path}.fields[${index}]`;
      if (typeof field === "string") {
        const fieldContract = stringFieldContract(field, contract);
        this.#appendPlanTarget(plan, "type", fieldContract.type, fieldPath);
        this.#appendPlanTarget(plan, "format", fieldContract.format.name, fieldPath);
      } else if (field.tag === "!repeat") {
        for (const [bodyIndex, bodyField] of field.body.entries()) {
          const bodyPath = `${fieldPath}.body[${bodyIndex}]`;
          if (typeof bodyField === "string") {
            const bodyContract = stringFieldContract(bodyField, contract);
            this.#appendPlanTarget(plan, "type", bodyContract.type, bodyPath);
            this.#appendPlanTarget(plan, "format", bodyContract.format.name, bodyPath);
          } else {
            this.#compileSchemaPlan(plan, bodyField, contract, bodyPath, false);
          }
        }
      } else {
        this.#compileSchemaPlan(plan, field, contract, fieldPath, false);
      }
    }

    if (schema.item) {
      this.#compileSchemaPlan(plan, schema.item, contract, `${path}.item`, false);
    }
    for (const [index, item] of (schema.items ?? []).entries()) {
      this.#compileSchemaPlan(plan, item, contract, `${path}.items[${index}]`, false);
    }
  }

  async #executeSchemaNode(
    plan: ArtifactValidationPlan,
    schema: SchemaNode,
    parent: CompiledArtifactContract,
    candidate: PreparedArtifactCandidate,
    rootContext: ArtifactValidationContext,
    contractPath: string,
    fieldPath: string
  ): Promise<ArtifactValidationResult> {
    const contract = schemaContract(schema, parent);
    const context = { ...rootContext, contractPath, fieldPath: fieldPath || undefined };
    const own = await this.#executeEntries(
      plan.filter((entry) => entry.contractPath === contractPath),
      { contract, candidate, context }
    );
    if (own.status !== "passed") return own;

    const arrayItems = await this.#executeArrayItems(
      plan,
      schema,
      contract,
      candidate,
      rootContext,
      contractPath,
      fieldPath
    );
    if (arrayItems.status !== "passed") return arrayItems;

    const children = deriveSchemaChildren(schema, contract, candidate, contractPath, fieldPath);
    for (const child of children) {
      const childContext = { ...rootContext, contractPath: child.contractPath, fieldPath: child.fieldPath };
      if (typeof child.field === "string") {
        const childContract = stringFieldContract(child.field, contract);
        const result = await this.#executeEntries(
          plan.filter((entry) => entry.contractPath === child.contractPath),
          { contract: childContract, candidate: child.candidate, context: childContext }
        );
        if (result.status !== "passed") return result;
      } else {
        const result = await this.#executeSchemaNode(
          plan,
          child.field,
          contract,
          child.candidate,
          rootContext,
          child.contractPath,
          child.fieldPath
        );
        if (result.status !== "passed") return result;
      }
    }
    return passedResult();
  }

  async #executeArrayItems(
    plan: ArtifactValidationPlan,
    schema: SchemaNode,
    contract: CompiledArtifactContract,
    candidate: PreparedArtifactCandidate,
    rootContext: ArtifactValidationContext,
    contractPath: string,
    fieldPath: string
  ): Promise<ArtifactValidationResult> {
    const value = candidate.representation.value;
    if (!Array.isArray(value) || (!schema.item && !schema.items?.length)) return passedResult();

    for (const [index, element] of value.entries()) {
      const elementPath = `${fieldPath || ""}[${index}]`;
      if (schema.item) {
        const itemContract = schemaContract(schema.item, contract);
        const result = await this.#executeSchemaNode(
          plan,
          schema.item,
          contract,
          candidateFromStructuredValue(candidate, element, itemContract, schema.item.format !== undefined),
          rootContext,
          `${contractPath}.item`,
          elementPath
        );
        if (result.status !== "passed") return result;
        continue;
      }

      const failures: ArtifactValidationResult[] = [];
      let matched = false;
      for (const [candidateIndex, itemSchema] of (schema.items ?? []).entries()) {
        const itemContract = schemaContract(itemSchema, contract);
        const result = await this.#executeSchemaNode(
          plan,
          itemSchema,
          contract,
          candidateFromStructuredValue(candidate, element, itemContract, itemSchema.format !== undefined),
          rootContext,
          `${contractPath}.items[${candidateIndex}]`,
          elementPath
        );
        if (result.status === "passed") {
          matched = true;
          break;
        }
        failures.push(result);
      }
      if (!matched) {
        const expected = (schema.items ?? []).map((item) => schemaContract(item, contract).type);
        return {
          status: "failed",
          correctable: failures.every((failure) => failure.correctable),
          issues: [
            {
              code: "artifact.schema.array.no_matching_item",
              stage: "schema",
              validatorId: "builtin.schema.array",
              artifactPath: rootContext.artifactPath,
              contractPath: `${contractPath}.items`,
              fieldPath: elementPath,
              actual: actualType(element),
              expected,
              message: `Array element ${elementPath} does not satisfy any items candidate`
            },
            ...failures.flatMap((failure) => failure.issues)
          ]
        };
      }
    }
    return passedResult();
  }

  async #executeEntries(plan: ArtifactValidationPlan, request: ArtifactValidationRequest): Promise<ArtifactValidationResult> {
    const representation = request.candidate.representation;
    if ((representation.kind === "json" || representation.kind === "yaml") && representation.decodeError) {
      return failedResult({
        code: "artifact.format.decode_failed",
        stage: "format",
        validatorId: `builtin.format.${representation.kind}`,
        artifactPath: request.context.artifactPath,
        contractPath: validationContractPath(request, "format"),
        fieldPath: request.context.fieldPath,
        actual: request.candidate.text,
        expected: representation.kind,
        message: representation.decodeError
      });
    }
    for (const entry of plan) {
      const registration = this.#byId.get(entry.id);
      if (!registration || registration.version !== entry.version || registration.stage !== entry.stage || registration.target !== entry.target) {
        return unsupportedResult(entry, request.context);
      }

      let result: ArtifactValidationResult;
      try {
        result = await registration.validator.validate(request);
      } catch (error) {
        result = failedResult({
          code: "artifact.validator.error",
          stage: entry.stage,
          validatorId: entry.id,
          artifactPath: request.context.artifactPath,
          contractPath: validationContractPath(request, entry.stage),
          fieldPath: request.context.fieldPath,
          message: error instanceof Error ? error.message : String(error)
        }, false);
      }
      if (!isValidationResult(result)) {
        return failedResult({
          code: "artifact.validator.invalid_result",
          stage: entry.stage,
          validatorId: entry.id,
          artifactPath: request.context.artifactPath,
          contractPath: validationContractPath(request, entry.stage),
          fieldPath: request.context.fieldPath,
          message: "validator returned an invalid result"
        }, false);
      }
      if (result.status !== "passed") {
        return {
          ...result,
          issues: result.issues.map((issue) => ({
            ...issue,
            contractPath: issue.contractPath ?? validationContractPath(request, entry.stage),
            fieldPath: issue.fieldPath ?? request.context.fieldPath
          }))
        };
      }
    }
    return passedResult();
  }
}

export function compileArtifactContract(artifact: ArtifactNode): CompiledArtifactContract {
  return {
    name: artifact.name,
    type: artifact.type,
    format: {
      name: artifact.format.name,
      options: structuredClone(artifact.format.options)
    },
    schema: artifact.schema ? structuredClone(artifact.schema) : undefined,
    final: artifact.final === true
  };
}

function schemaContract(schema: SchemaNode, parent: CompiledArtifactContract): CompiledArtifactContract {
  const resolved = resolveSchemaContract(schema, parent.format);
  return {
    name: schema.names[0] ?? parent.name,
    type: resolved.type,
    format: structuredClone(resolved.format),
    schema,
    final: false
  };
}

function stringFieldContract(name: string, parent: CompiledArtifactContract): CompiledArtifactContract {
  return {
    name,
    type: "string",
    format: inheritSchemaFormat(parent.format, "string"),
    final: false
  };
}

function sameContractRepresentation(left: CompiledArtifactContract, right: CompiledArtifactContract): boolean {
  return left.type === right.type &&
    left.format.name === right.format.name &&
    JSON.stringify(left.format.options) === JSON.stringify(right.format.options);
}

export async function prepareArtifactCandidate(
  contract: CompiledArtifactContract,
  source: ArtifactReportSource,
  context: ArtifactValidationContext
): Promise<PreparedArtifactCandidate> {
  const raw = source.kind === "file"
    ? new Uint8Array(await readFile(source.path))
    : new TextEncoder().encode(source.value);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  const snapshotSource = source.kind === "file"
    ? { kind: "file" as const, path: source.path }
    : { kind: "inline" as const };

  try {
    switch (contract.format.name) {
      case "plain":
        return { source: snapshotSource, raw, text, representation: { kind: "plain", value: decodePlain(text, contract.type) } };
      case "json":
        return { source: snapshotSource, raw, text, representation: { kind: "json", value: JSON.parse(text) } };
      case "yaml":
        return { source: snapshotSource, raw, text, representation: { kind: "yaml", value: parseYaml(text) } };
      case "markdown": {
        const ast = markdown.parse(text, {}) as MarkdownToken[];
        const layout = contract.format.options.layout;
        const value = layout === "outline" ? {} : layout === "table" ? decodeMarkdownTable(ast) : decodePlain(text, contract.type);
        return { source: snapshotSource, raw, text, representation: { kind: "markdown", value, ast } };
      }
      default:
        throw new Error(`unsupported Artifact format decoder: ${contract.format.name}`);
    }
  } catch (error) {
    throw new ArtifactValidationFailure(failedResult({
      code: "artifact.format.decode_failed",
      stage: "format",
      validatorId: `builtin.format.${contract.format.name}`,
      artifactPath: context.artifactPath,
      contractPath: "format",
      actual: text,
      expected: contract.format.name,
      message: error instanceof Error ? error.message : String(error)
    }));
  }
}

export function createBuiltInArtifactValidatorRegistry(): ArtifactValidatorRegistry {
  const registry = new ArtifactValidatorRegistry();
  for (const type of ["boolean", "number", "string", "object", "array"] as const) {
    registry.register({
      id: `builtin.type.${type}`,
      version: "1",
      stage: "type",
      target: type,
      validator: new TypeValidator(type)
    });
  }
  for (const format of ["plain", "markdown", "json", "yaml"] as const) {
    registry.register({
      id: `builtin.format.${format}`,
      version: "1",
      stage: "format",
      target: format,
      validator: new FormatValidator(format)
    });
  }
  registry.register(schemaRegistration("object", new StructuredObjectSchemaValidator()));
  registry.register(schemaRegistration("array", new StructuredArraySchemaValidator()));
  registry.register(schemaRegistration("markdown:outline", new MarkdownOutlineSchemaValidator()));
  registry.register(schemaRegistration("markdown:table", new MarkdownTableSchemaValidator()));
  return registry;
}

class TypeValidator implements ArtifactValidator {
  constructor(readonly expected: string) {}

  validate(request: ArtifactValidationRequest): ArtifactValidationResult {
    const value = request.candidate.representation.value;
    const valid = actualType(value) === this.expected;
    return valid ? passedResult() : failedResult({
      code: `artifact.type.expected_${this.expected}`,
      stage: "type",
      validatorId: `builtin.type.${this.expected}`,
      artifactPath: request.context.artifactPath,
      contractPath: validationContractPath(request, "type"),
      fieldPath: request.context.fieldPath,
      actual: actualType(value),
      expected: this.expected,
      message: `Artifact value must decode as ${this.expected}`
    });
  }
}

class FormatValidator implements ArtifactValidator {
  constructor(readonly expected: string) {}

  validate(request: ArtifactValidationRequest): ArtifactValidationResult {
    const representation = request.candidate.representation;
    if (representation.kind !== this.expected) {
      return failedResult({
        code: "artifact.format.representation_mismatch",
        stage: "format",
        validatorId: `builtin.format.${this.expected}`,
        artifactPath: request.context.artifactPath,
        contractPath: validationContractPath(request, "format"),
        fieldPath: request.context.fieldPath,
        actual: representation.kind,
        expected: this.expected,
        message: `Artifact representation must be ${this.expected}`
      }, false);
    }
    const optionNames = Object.keys(request.contract.format.options);
    const allowed = this.expected === "markdown" ? ["layout"] : [];
    const unknown = optionNames.find((name) => !allowed.includes(name));
    if (unknown) {
      return failedResult({
        code: "artifact.format.unknown_option",
        stage: "format",
        validatorId: `builtin.format.${this.expected}`,
        artifactPath: request.context.artifactPath,
        contractPath: `${validationContractPath(request, "format")}.${unknown}`,
        fieldPath: request.context.fieldPath,
        actual: request.contract.format.options[unknown],
        expected: allowed,
        message: `format ${this.expected} does not support option ${unknown}`
      }, false);
    }
    return passedResult();
  }
}

class StructuredObjectSchemaValidator implements ArtifactValidator {
  validate(request: ArtifactValidationRequest): ArtifactValidationResult {
    const schema = requireInlineSchema(request);
    if (!schema) return passedResult();
    return validateObjectFields(request, request.candidate.representation.value, schema, "builtin.schema.object");
  }
}

class StructuredArraySchemaValidator implements ArtifactValidator {
  validate(_request: ArtifactValidationRequest): ArtifactValidationResult {
    return passedResult();
  }
}

class MarkdownOutlineSchemaValidator implements ArtifactValidator {
  validate(request: ArtifactValidationRequest): ArtifactValidationResult {
    const schema = requireInlineSchema(request);
    const representation = request.candidate.representation;
    if (!schema || representation.kind !== "markdown") return passedResult();
    const headings = extractMarkdownHeadings(representation.ast);
    const issues = validateMarkdownOutline(request, schema.fields ?? [], headings);
    return issues.length
      ? { status: "failed", correctable: true, issues }
      : passedResult();
  }
}

class MarkdownTableSchemaValidator implements ArtifactValidator {
  validate(request: ArtifactValidationRequest): ArtifactValidationResult {
    const schema = requireInlineSchema(request);
    const representation = request.candidate.representation;
    if (!schema || representation.kind !== "markdown") return passedResult();
    const headers = extractMarkdownTableHeaders(representation.ast);
    const columns = tableSchemaColumns(schema);
    if (!headers.length) {
      return failedResult({
        code: "artifact.schema.markdown_table.missing_table",
        stage: "schema",
        validatorId: "builtin.schema.markdown-table",
        artifactPath: request.context.artifactPath,
        contractPath: validationContractPath(request, columns.contractSuffix),
        fieldPath: request.context.fieldPath,
        expected: columns.names,
        message: "Markdown Artifact must contain a GFM table"
      });
    }
    const missing = columns.groups.find((aliases) => !aliases.some((name) => headers.includes(name)));
    if (missing) return failedResult({
      code: "artifact.schema.markdown_table.missing_column",
      stage: "schema",
      validatorId: "builtin.schema.markdown-table",
      artifactPath: request.context.artifactPath,
      contractPath: validationContractPath(request, columns.contractSuffix),
      fieldPath: joinFieldPath(request.context.fieldPath ?? "", missing[0]),
      actual: headers,
      expected: missing,
      message: `Markdown table is missing column ${missing[0]}`
    });
    return passedResult();
  }
}

const markdown = new MarkdownIt({ html: false, linkify: true, typographer: false });

function schemaRegistration(target: string, validator: ArtifactValidator): ArtifactValidatorRegistration {
  return {
    id: `builtin.schema.${target.replace(/:/g, "-")}`,
    version: "1",
    stage: "schema",
    target,
    validator
  };
}

function schemaTarget(contract: CompiledArtifactContract): string {
  const layout = contract.format.options.layout;
  if (contract.format.name === "markdown" && (layout === "outline" || layout === "table")) {
    return `markdown:${layout}`;
  }
  return contract.type;
}

function decodePlain(text: string, type: string): unknown {
  const trimmed = text.trim();
  if (type === "boolean") {
    if (["true", "yes", "y", "1", "继续", "是"].includes(trimmed.toLowerCase())) return true;
    if (["false", "no", "n", "0", "停止", "否"].includes(trimmed.toLowerCase())) return false;
  }
  if (type === "number") {
    const value = Number(trimmed);
    if (trimmed && Number.isFinite(value)) return value;
  }
  return text;
}

function actualType(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value !== null && typeof value === "object") return "object";
  return typeof value;
}

type DerivedSchemaChild = {
  field: string | SchemaNode;
  contractPath: string;
  fieldPath: string;
  candidate: PreparedArtifactCandidate;
};

function deriveSchemaChildren(
  schema: SchemaNode,
  contract: CompiledArtifactContract,
  candidate: PreparedArtifactCandidate,
  contractPath: string,
  fieldPath: string
): DerivedSchemaChild[] {
  if (!schema.fields?.length) return [];
  if (candidate.representation.kind === "markdown" && contract.format.name === "markdown" && contract.format.options.layout === "outline") {
    return deriveMarkdownOutlineChildren(schema, contract, candidate, contractPath, fieldPath);
  }

  const value = candidate.representation.value;
  if (value && typeof value === "object") {
    return deriveRecordChildren(schema, contract, candidate, value as Record<string, unknown>, contractPath, fieldPath);
  }
  return [];
}

function deriveMarkdownOutlineChildren(
  schema: SchemaNode,
  contract: CompiledArtifactContract,
  candidate: PreparedArtifactCandidate,
  contractPath: string,
  fieldPath: string
): DerivedSchemaChild[] {
  if (candidate.representation.kind !== "markdown") return [];
  const headings = extractMarkdownHeadings(candidate.representation.ast);
  const firstField = firstConcreteField(schema.fields ?? []);
  const firstHeading = firstField
    ? headings.find((heading) => headingMatches(heading, firstField, undefined))
    : undefined;
  const parentIndex = firstHeading?.parentIndex;
  const children: DerivedSchemaChild[] = [];
  let cursor = 0;

  for (const [index, field] of (schema.fields ?? []).entries()) {
    const path = `${contractPath}.fields[${index}]`;
    if (typeof field === "object" && field.tag === "!repeat") {
      const first = field.body[0];
      if (!first) continue;
      const occurrences = headings.filter((heading) =>
        heading.index >= cursor &&
        heading.parentIndex === parentIndex &&
        headingMatches(heading, first, undefined)
      );
      for (const [iterationIndex, occurrence] of occurrences.entries()) {
        const groupEnd = occurrences[iterationIndex + 1]?.index ?? headings.length;
        for (const [bodyIndex, bodyField] of field.body.entries()) {
          const match = bodyIndex === 0
            ? occurrence
            : findOutlineHeading(headings, bodyField, occurrence.index + 1, groupEnd, parentIndex, iterationIndex + 1);
          if (!match) continue;
          children.push(derivedMarkdownChild(
            bodyField,
            `${path}.body[${bodyIndex}]`,
            joinFieldPath(fieldPath, `${primaryFieldName(bodyField)}[${iterationIndex + 1}]`),
            contract,
            candidate,
            headings,
            match
          ));
        }
      }
      cursor = Math.max(cursor, occurrences.at(-1)?.index ?? cursor);
      continue;
    }

    const match = findOutlineHeading(headings, field, cursor, headings.length, parentIndex);
    if (!match) continue;
    children.push(derivedMarkdownChild(
      field,
      path,
      joinFieldPath(fieldPath, primaryFieldName(field)),
      contract,
      candidate,
      headings,
      match
    ));
    cursor = match.index + 1;
  }
  return children;
}

function derivedMarkdownChild(
  field: string | SchemaNode,
  contractPath: string,
  fieldPath: string,
  parentContract: CompiledArtifactContract,
  parentCandidate: PreparedArtifactCandidate,
  headings: readonly MarkdownHeading[],
  heading: MarkdownHeading
): DerivedSchemaChild {
  const contract = typeof field === "string" ? stringFieldContract(field, parentContract) : schemaContract(field, parentContract);
  return {
    field,
    contractPath,
    fieldPath,
    candidate: candidateFromMarkdownSubtree(parentCandidate, headings, heading, contract)
  };
}

function candidateFromMarkdownSubtree(
  parent: PreparedArtifactCandidate,
  headings: readonly MarkdownHeading[],
  heading: MarkdownHeading,
  contract: CompiledArtifactContract
): PreparedArtifactCandidate {
  if (parent.representation.kind !== "markdown") return parent;
  const endHeading = headings[subtreeEnd(headings, heading, headings.length)];
  const tokens = parent.representation.ast.slice(heading.tokenIndex, endHeading?.tokenIndex ?? parent.representation.ast.length);
  const headingToken = parent.representation.ast[heading.tokenIndex];
  const startLine = headingToken?.map?.[1] ?? 0;
  const endLine = endHeading
    ? parent.representation.ast[endHeading.tokenIndex]?.map?.[0]
    : undefined;
  const lines = (parent.text ?? "").split(/\r?\n/);
  const text = lines.slice(startLine, endLine).join("\n").trim();
  let representation: ArtifactRepresentation;

  switch (contract.format.name) {
    case "plain":
      representation = { kind: "plain", value: decodePlain(text, contract.type) };
      break;
    case "json":
      representation = decodeStructuredSection(text, "json");
      break;
    case "yaml":
      representation = decodeStructuredSection(text, "yaml");
      break;
    case "markdown":
      representation = {
        kind: "markdown",
        value: contract.format.options.layout === "outline"
          ? {}
          : contract.format.options.layout === "table"
            ? decodeMarkdownTable(tokens)
            : decodePlain(text, contract.type),
        ast: tokens
      };
      break;
    default:
      representation = { kind: "plain", value: text };
  }

  return {
    source: parent.source,
    raw: new TextEncoder().encode(text),
    text: contract.format.name === "markdown" ? parent.text : text,
    representation
  };
}

function decodeStructuredSection(
  text: string,
  format: "json" | "yaml"
): Extract<ArtifactRepresentation, { kind: "json" | "yaml" }> {
  try {
    return { kind: format, value: format === "json" ? JSON.parse(text) : parseYaml(text) };
  } catch (error) {
    return {
      kind: format,
      value: text,
      decodeError: error instanceof Error ? error.message : String(error)
    };
  }
}

function deriveRecordChildren(
  schema: SchemaNode,
  contract: CompiledArtifactContract,
  parentCandidate: PreparedArtifactCandidate,
  record: Record<string, unknown>,
  contractPath: string,
  fieldPath: string
): DerivedSchemaChild[] {
  const children: DerivedSchemaChild[] = [];
  for (const [index, field] of (schema.fields ?? []).entries()) {
    if (typeof field === "object" && field.tag === "!repeat") continue;
    const names = fieldNames(field);
    const key = names.find((name) => Object.hasOwn(record, name));
    if (!key) continue;
    const path = `${contractPath}.fields[${index}]`;
    const childPath = joinFieldPath(fieldPath, primaryFieldName(field));
    const childContract = typeof field === "string" ? stringFieldContract(field, contract) : schemaContract(field, contract);
    children.push({
      field,
      contractPath: path,
      fieldPath: childPath,
      candidate: candidateFromStructuredValue(
        parentCandidate,
        record[key],
        childContract,
        typeof field === "object" && field.format !== undefined
      )
    });
  }
  return children;
}

function candidateFromStructuredValue(
  parent: PreparedArtifactCandidate,
  value: unknown,
  contract: CompiledArtifactContract,
  decodeLocalFormat = false
): PreparedArtifactCandidate {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let representation: ArtifactRepresentation;
  switch (contract.format.name) {
    case "plain":
      representation = {
        kind: "plain",
        value: typeof value === "string" ? decodePlain(value, contract.type) : value
      };
      break;
    case "json":
      representation = typeof value === "string" && decodeLocalFormat
        ? decodeStructuredSection(value, "json")
        : { kind: "json", value };
      break;
    case "yaml":
      representation = typeof value === "string" && decodeLocalFormat
        ? decodeStructuredSection(value, "yaml")
        : { kind: "yaml", value };
      break;
    case "markdown": {
      const ast = markdown.parse(text ?? "", {}) as MarkdownToken[];
      representation = {
        kind: "markdown",
        value: contract.format.options.layout === "outline"
          ? {}
          : contract.format.options.layout === "table"
            ? decodeMarkdownTable(ast)
            : (["object", "array"].includes(contract.type) ? value : decodePlain(text, contract.type)),
        ast
      };
      break;
    }
    default:
      representation = { kind: parent.representation.kind === "plain" ? "plain" : parent.representation.kind, value } as ArtifactRepresentation;
  }
  return {
    source: parent.source,
    raw: new TextEncoder().encode(text ?? ""),
    text,
    representation
  };
}

function joinFieldPath(prefix: string, name: string): string {
  return prefix ? `${prefix}.${name}` : name;
}

function validationContractPath(request: ArtifactValidationRequest, suffix: string): string {
  return request.context.contractPath ? `${request.context.contractPath}.${suffix}` : suffix;
}

function requireInlineSchema(request: ArtifactValidationRequest): SchemaNode | undefined {
  return typeof request.contract.schema === "object" ? request.contract.schema : undefined;
}

function validateObjectFields(
  request: ArtifactValidationRequest,
  value: unknown,
  schema: SchemaNode,
  validatorId: string
): ArtifactValidationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return failedResult({
      code: "artifact.schema.object.expected_object",
      stage: "schema",
      validatorId,
      artifactPath: request.context.artifactPath,
      contractPath: validationContractPath(request, "fields"),
      fieldPath: request.context.fieldPath,
      actual: actualType(value),
      expected: "object",
      message: `${request.context.fieldPath ?? "Artifact"} must be an object to satisfy Schema fields`
    });
  }
  const record = value as Record<string, unknown>;
  for (const field of schema.fields ?? []) {
    if (typeof field === "object" && field.tag === "!repeat") continue;
    const names = fieldNames(field);
    const name = names.find((candidate) => Object.hasOwn(record, candidate)) ?? names[0];
    if (!names.some((candidate) => Object.hasOwn(record, candidate))) {
      const fieldPath = joinFieldPath(request.context.fieldPath ?? "", name);
      return failedResult({
        code: "artifact.schema.object.missing_field",
        stage: "schema",
        validatorId,
        artifactPath: request.context.artifactPath,
        contractPath: validationContractPath(request, "fields"),
        fieldPath,
        actual: Object.keys(record),
        expected: name,
        message: `Artifact object is missing field ${fieldPath}`
      });
    }
  }
  return passedResult();
}

function decodeMarkdownTable(tokens: readonly MarkdownToken[]): Array<Record<string, string>> {
  const headers = extractMarkdownTableHeaders(tokens);
  const bodyOpen = tokens.findIndex((token) => token.type === "tbody_open");
  const bodyClose = tokens.findIndex((token, index) => index > bodyOpen && token.type === "tbody_close");
  if (bodyOpen < 0 || bodyClose < 0) return [];
  const rows: Array<Record<string, string>> = [];
  let cells: string[] | undefined;
  for (const token of tokens.slice(bodyOpen + 1, bodyClose)) {
    if (token.type === "tr_open") cells = [];
    if (token.type === "inline" && cells) cells.push(token.content.trim());
    if (token.type === "tr_close" && cells) {
      rows.push(Object.fromEntries(headers.map((header, index) => [header, cells?.[index] ?? ""])));
      cells = undefined;
    }
  }
  return rows;
}

type MarkdownHeading = {
  index: number;
  tokenIndex: number;
  level: number;
  text: string;
  parentIndex?: number;
};

function extractMarkdownHeadings(tokens: readonly MarkdownToken[]): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const ancestors: MarkdownHeading[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "heading_open") continue;
    const inline = tokens[index + 1];
    const level = Number(token.tag.slice(1));
    while (ancestors.at(-1) && ancestors.at(-1)!.level >= level) ancestors.pop();
    const heading: MarkdownHeading = {
      index: headings.length,
      tokenIndex: index,
      level,
      text: inline?.content.trim() ?? "",
      parentIndex: ancestors.at(-1)?.index
    };
    headings.push(heading);
    ancestors.push(heading);
  }
  return headings;
}

function validateMarkdownOutline(
  request: ArtifactValidationRequest,
  fields: readonly SchemaField[],
  headings: readonly MarkdownHeading[]
): ArtifactValidationIssue[] {
  const issues: ArtifactValidationIssue[] = [];
  const firstField = firstConcreteField(fields);
  const firstHeading = firstField
    ? headings.find((heading) => headingMatches(heading, firstField, undefined))
    : undefined;
  validateOutlineFields(request, fields, headings, {
    start: 0,
    end: headings.length,
    parentIndex: firstHeading?.parentIndex,
    path: []
  }, issues);
  return issues;
}

type OutlineRange = {
  start: number;
  end: number;
  parentIndex?: number;
  path: string[];
};

function inheritsMarkdownOutline(schema: SchemaNode): boolean {
  return schema.format === undefined && inferSchemaType(schema) === "object";
}

function validateOutlineFields(
  request: ArtifactValidationRequest,
  fields: readonly SchemaField[],
  headings: readonly MarkdownHeading[],
  range: OutlineRange,
  issues: ArtifactValidationIssue[]
): number {
  let cursor = range.start;
  for (const field of fields) {
    if (typeof field === "object" && field.tag === "!repeat") {
      cursor = validateOutlineRepeat(request, field, headings, { ...range, start: cursor }, issues);
      continue;
    }
    const match = findOutlineHeading(headings, field, cursor, range.end, range.parentIndex);
    const path = [...range.path, primaryFieldName(field)];
    if (!match) {
      issues.push(outlineIssue(request, "schema.format.outline.expected_heading", path, {
        actual: headings.slice(cursor, range.end).map((heading) => heading.text),
        expected: fieldNames(field),
        message: `Markdown outline is missing heading ${path.join(" / ")}`
      }));
      if (typeof field === "object" && inheritsMarkdownOutline(field)) {
        reportChildrenUnderMissingParent(request, field, headings, { ...range, start: cursor }, path, issues);
      }
      continue;
    }
    if (match.parentIndex !== range.parentIndex) {
      issues.push(outlineIssue(request, "schema.format.outline.invalid_parent", path, {
        actual: parentHeadingText(headings, match),
        expected: range.path.at(-1) ?? "document root",
        message: `Heading ${path.at(-1)} is under the wrong parent`
      }));
    }
    cursor = Math.max(cursor, match.index + 1);
    if (typeof field === "object" && inheritsMarkdownOutline(field)) {
      const childEnd = subtreeEnd(headings, match, range.end);
      validateOutlineFields(request, field.fields ?? [], headings, {
        start: match.index + 1,
        end: childEnd,
        parentIndex: match.index,
        path
      }, issues);
    }
  }
  return cursor;
}

function validateOutlineRepeat(
  request: ArtifactValidationRequest,
  repeat: Extract<SchemaField, { tag: "!repeat" }>,
  headings: readonly MarkdownHeading[],
  range: OutlineRange,
  issues: ArtifactValidationIssue[]
): number {
  const first = repeat.body[0];
  if (!first) return range.start;
  const occurrences = headings.filter((heading) =>
    heading.index >= range.start &&
    heading.index < range.end &&
    heading.parentIndex === range.parentIndex &&
    headingMatches(heading, first, undefined)
  );
  const min = repeat.limit?.min ?? 0;
  const max = repeat.limit?.max;
  const expectedCount = Math.max(min, occurrences.length);
  if (max !== undefined && occurrences.length > max) {
    issues.push(outlineIssue(request, "schema.format.outline.repeat_count", [...range.path, primaryFieldName(first)], {
      actual: occurrences.length,
      expected: `${min}..${max}`,
      message: `Markdown outline repeat count exceeds ${max}`
    }));
  }

  let cursor = range.start;
  for (let iteration = 1; iteration <= expectedCount; iteration += 1) {
    const groupStart = occurrences[iteration - 1]?.index ?? cursor;
    const groupEnd = occurrences[iteration]?.index ?? range.end;
    for (const [bodyIndex, field] of repeat.body.entries()) {
      const path = [...range.path, `${primaryFieldName(field)}[${iteration}]`];
      const match = bodyIndex === 0
        ? occurrences[iteration - 1]
        : findOutlineHeading(headings, field, groupStart + 1, groupEnd, range.parentIndex, iteration);
      if (!match) {
        issues.push(outlineIssue(request, "schema.format.outline.expected_heading", path, {
          actual: headings.slice(groupStart, groupEnd).map((heading) => heading.text),
          expected: fieldNames(field),
          message: `Markdown outline is missing heading ${path.join(" / ")}`
        }));
        if (typeof field === "object" && inheritsMarkdownOutline(field)) {
          reportChildrenUnderMissingParent(request, field, headings, {
            start: groupStart,
            end: groupEnd,
            parentIndex: range.parentIndex,
            path: range.path
          }, path, issues);
        }
        continue;
      }
      cursor = Math.max(cursor, match.index + 1);
      if (typeof field === "object" && inheritsMarkdownOutline(field)) {
        validateOutlineFields(request, field.fields ?? [], headings, {
          start: match.index + 1,
          end: subtreeEnd(headings, match, groupEnd),
          parentIndex: match.index,
          path
        }, issues);
      }
    }
  }
  return cursor;
}

function reportChildrenUnderMissingParent(
  request: ArtifactValidationRequest,
  schema: SchemaNode,
  headings: readonly MarkdownHeading[],
  range: OutlineRange,
  parentPath: string[],
  issues: ArtifactValidationIssue[]
): void {
  for (const child of schema.fields ?? []) {
    if (typeof child === "object" && child.tag === "!repeat") continue;
    const match = findOutlineHeading(headings, child, range.start, range.end, undefined);
    if (!match) continue;
    const path = [...parentPath, primaryFieldName(child)];
    issues.push(outlineIssue(request, "schema.format.outline.invalid_parent", path, {
      actual: parentHeadingText(headings, match),
      expected: parentPath.at(-1),
      message: `Heading ${path.at(-1)} is not nested under ${parentPath.at(-1)}`
    }));
  }
}

function findOutlineHeading(
  headings: readonly MarkdownHeading[],
  field: string | SchemaNode,
  start: number,
  end: number,
  parentIndex: number | undefined,
  iteration?: number
): MarkdownHeading | undefined {
  const candidates = headings.filter((heading) =>
    heading.index >= start && heading.index < end && headingMatches(heading, field, iteration)
  );
  return candidates.find((heading) => heading.parentIndex === parentIndex) ?? candidates[0];
}

function headingMatches(heading: MarkdownHeading, field: string | SchemaNode, iteration: number | undefined): boolean {
  return fieldNames(field).some((name) =>
    heading.text === name ||
    heading.text === `${name} ${iteration}` ||
    (iteration === undefined && new RegExp(`^${escapeRegExp(name)}\\s+\\d+$`).test(heading.text))
  );
}

function firstConcreteField(fields: readonly SchemaField[]): string | SchemaNode | undefined {
  for (const field of fields) {
    if (typeof field === "object" && field.tag === "!repeat") {
      if (field.body[0]) return field.body[0];
      continue;
    }
    return field;
  }
  return undefined;
}

function primaryFieldName(field: string | SchemaNode): string {
  return typeof field === "string" ? field : field.names[0];
}

function subtreeEnd(headings: readonly MarkdownHeading[], heading: MarkdownHeading, limit: number): number {
  return headings.find((candidate) =>
    candidate.index > heading.index && candidate.index < limit && candidate.level <= heading.level
  )?.index ?? limit;
}

function parentHeadingText(headings: readonly MarkdownHeading[], heading: MarkdownHeading): string {
  return heading.parentIndex === undefined ? "document root" : headings[heading.parentIndex]?.text ?? "document root";
}

function outlineIssue(
  request: ArtifactValidationRequest,
  code: string,
  path: string[],
  detail: Pick<ArtifactValidationIssue, "actual" | "expected" | "message">
): ArtifactValidationIssue {
  return {
    code,
    stage: "schema",
    validatorId: "builtin.schema.markdown-outline",
    artifactPath: request.context.artifactPath,
    contractPath: validationContractPath(request, "fields"),
    fieldPath: [request.context.fieldPath, path.join(" / ")].filter(Boolean).join(" / "),
    ...detail
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractMarkdownTableHeaders(tokens: readonly MarkdownToken[]): string[] {
  const open = tokens.findIndex((token) => token.type === "thead_open");
  const close = tokens.findIndex((token, index) => index > open && token.type === "thead_close");
  if (open < 0 || close < 0) return [];
  return tokens.slice(open, close)
    .filter((token) => token.type === "inline")
    .map((token) => token.content.trim());
}

function schemaFieldNameGroups(fields: readonly SchemaField[]): string[][] {
  return fields.flatMap((field) => {
    if (typeof field === "string") return [[field]];
    if (field.tag === "!repeat") return field.body.map((bodyField) => fieldNames(bodyField));
    return [fieldNames(field)];
  });
}

function tableSchemaColumns(schema: SchemaNode): { names: string[]; groups: string[][]; contractSuffix: string } {
  if (schema.item) {
    const groups = schemaFieldNameGroups(schema.item.fields ?? []);
    return { names: groups.map(([name]) => name), groups, contractSuffix: "item.fields" };
  }
  if (schema.items?.length) {
    const groups = schema.items.flatMap((item) => schemaFieldNameGroups(item.fields ?? []));
    return {
      names: [...new Set(groups.map(([name]) => name))],
      groups,
      contractSuffix: "items"
    };
  }
  const groups = schemaFieldNameGroups(schema.fields ?? []);
  return { names: groups.map(([name]) => name), groups, contractSuffix: "fields" };
}

function fieldNames(field: string | SchemaNode): string[] {
  return typeof field === "string" ? [field] : field.names;
}

function passedResult(): ArtifactValidationResult {
  return { status: "passed", correctable: false, issues: [] };
}

function failedResult(issue: ArtifactValidationIssue, correctable = true): ArtifactValidationResult {
  return { status: "failed", correctable, issues: [issue] };
}

function unsupportedResult(entry: ArtifactValidationPlanEntry, context: ArtifactValidationContext): ArtifactValidationResult {
  return {
    status: "unsupported",
    correctable: false,
    issues: [{
      code: "artifact.validator.unsupported",
      stage: entry.stage,
      validatorId: entry.id,
      artifactPath: context.artifactPath,
      contractPath: context.contractPath ? `${context.contractPath}.${entry.stage}` : entry.stage,
      fieldPath: context.fieldPath,
      expected: `${entry.id}@${entry.version}`,
      message: `Artifact validator is not registered: ${entry.id}@${entry.version}`
    }]
  };
}

function isValidationResult(value: unknown): value is ArtifactValidationResult {
  return Boolean(
    value &&
    typeof value === "object" &&
    ["passed", "failed", "unsupported"].includes(String((value as ArtifactValidationResult).status)) &&
    typeof (value as ArtifactValidationResult).correctable === "boolean" &&
    Array.isArray((value as ArtifactValidationResult).issues)
  );
}
