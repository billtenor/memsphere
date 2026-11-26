import { z } from "zod";
import { PaginationError } from "../pagination.js";
import type { ModelRegistration } from "../project/model-registration-contract.js";
import { commandFacts, inline, previewText, renderCliResult } from "./output.js";

const text = z.string();
const optional = text.optional();
const project = { project: optional };
const pagination = { nextCursor: optional };

const registration = z.object({
  modelRef: text, name: optional, description: optional,
  package: optional, package_name: optional, tags: z.array(text).optional()
}).strict();

export function publicRegistration(value: ModelRegistration) {
  return {
    modelRef: value.modelRef, name: value.name, description: value.description,
    package: value.package, package_name: value.package_name, tags: value.tags
  };
}

export const modelListResult = z.object({
  ...project, ...pagination, items: z.array(z.object({
    id: text, title: optional, name: optional, origin: optional, status: text, errorCode: optional
  }).strict())
}).strict();
export const modelReadResult = z.object({
  ...project, modelRef: text, registration: registration.optional(), origin: optional,
  // This field is the model definition explicitly requested with --part.
  definition: z.unknown().optional()
}).strict();
export const modelWriteResult = z.object({
  ...project, operation: text, modelRef: text, registration: registration.optional(), dryRun: z.literal(true).optional()
}).strict();
export const modelValidationResult = z.object({
  ...project, operation: text, modelRef: text, valid: z.boolean(),
  checks: z.object({ definition: text, runtime: text }).strict(),
  data: z.array(z.object({ storeId: text, checked: z.number().int().nonnegative() }).strict()).optional()
}).strict();

const dataIdentity = { ...project, storeId: optional, id: optional, modelRef: text };
const dataMetadata = {
  revision: optional, contentType: optional, createdAt: z.number().optional(),
  updatedAt: z.number().optional(), deleted: z.boolean().optional()
};
export const dataPageResult = z.object({
  ...project, storeId: text, ...pagination,
  items: z.array(z.object({ id: text }).strict())
}).strict();
export function dataPageFacts(page: z.input<typeof dataPageResult>, limit: number) {
  const rowBytes = 2 * 1024;
  const envelopeBytes = 8 * 1024;
  if (page.items.length > limit || page.items.some(item => Math.max(
    Buffer.byteLength(JSON.stringify(item)) + 1, Buffer.byteLength(`- id=${inline(item.id)}\n`)) > rowBytes)) {
    throw new PaginationError("Provider page exceeds the record ID budget", "OUTPUT_LIMIT_EXCEEDED");
  }
  const envelope = { ...page, items: [] };
  const views = [{ format: "json" }, { format: "text", locale: "en" }, { format: "text", locale: "zh-CN" }] as const;
  if (views.some(view => Buffer.byteLength(renderCliResult("data list", dataPageResult, envelope, view)) > envelopeBytes)) {
    throw new PaginationError("Provider page exceeds the cursor budget", "OUTPUT_LIMIT_EXCEEDED");
  }
  return commandFacts(() => dataPageResult.parse(page));
}

export const dataExistsResult = z.object({ ...dataIdentity, exists: z.boolean() }).strict();
export const dataWriteResult = z.object({
  ...dataIdentity, ...dataMetadata, operation: text, dryRun: z.boolean().optional(), expectedRevision: optional,
  out: optional, bytes: z.number().int().nonnegative().optional(), valid: z.boolean().optional()
}).strict();
export const businessStoreSummary = z.object({
  storeId: text, model: text, kind: z.enum(["value", "data"]), factory: text, status: text, errorCode: optional
}).strict();
export const businessStoreListResult = z.object({
  ...project, ...pagination, items: z.array(businessStoreSummary)
}).strict();
export const businessStoreReadResult = businessStoreSummary.extend({
  ...project, idRule: text,
  capabilities: z.object({
    value: z.boolean(), payload: z.boolean(), conditionalWrite: z.boolean(),
    update: z.boolean(), upsert: z.boolean(), edit: z.boolean()
  }).strict(),
  contentTypeExtensions: z.record(z.array(text)).optional()
}).strict();
export const businessStoreWriteResult = z.object({
  ...project, operation: text, storeId: text, model: optional, kind: z.enum(["value", "data"]).optional(),
  factory: optional, dataRetained: z.boolean().optional(), pendingCleanup: z.boolean().optional(), dryRun: z.boolean().optional()
}).strict();

export function modelLabel(value: string | undefined) {
  return value === undefined ? undefined : previewText(value, 160).text;
}
