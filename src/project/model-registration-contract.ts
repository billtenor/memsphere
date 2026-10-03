export const MODEL_REGISTRATION_MODEL = "memsphere/model-registration";
export const LEGACY_MODEL_REGISTRATION_MODEL = "memsphere/model-registration.json";
export const IMPORTED_MODEL_DEFINITIONS_STORE = "models/imported/json-schema/draft-07";
export type ModelOrigin = "project" | "system" | "market";
export type ModelRegistration = {
  modelRef: string;
  name?: string;
  description?: string;
  package?: string;
  package_name?: string;
  tags?: string[];
  storage: "builtin" | "store";
  store_id?: string;
};
export type ModelRegistrationConfig = {
  storeId: string;
  stores: Record<string, {
    factory: "memsphere/filesystem-json";
    directory: string;
  }>;
  excludedDirectories?: string[];
};
export type ProjectModelInput = {
  root: string;
  modelsDirectory?: string;
  modelRegistration?: ModelRegistrationConfig;
};
export const DEFAULT_MODEL_REGISTRATION_CONFIG: ModelRegistrationConfig = { storeId: "memsphere/model-registrations", stores: { "memsphere/model-registrations": { factory: "memsphere/filesystem-json", directory: "models/registrations" } } };
export const SYSTEM_JSON_SCHEMA_MODELS_STORE = "models/system/json-schema/draft-07";
export const SYSTEM_RAW_MODELS_STORE = "models/system/raw";
export function validateModelRegistration(value: unknown): asserts value is ModelRegistration {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid model registration: expected object");
  const v = value as Record<string, unknown>;
  const keys = new Set(["modelRef", "name", "description", "package", "package_name", "tags", "storage", "store_id"]);
  for (const key of Object.keys(v))
    if (!keys.has(key))
      throw new TypeError(`Unknown model registration field: ${key}`);
  for (const key of ["modelRef", "name", "package", "package_name", "store_id"])
    if ((key === "modelRef" || v[key] !== undefined) && (typeof v[key] !== "string" || !(v[key] as string).trim()))
      throw new TypeError(`Invalid model registration ${key}`);
  if (v.description !== undefined && typeof v.description !== "string")
    throw new TypeError("Invalid model registration description");
  if (v.storage !== "builtin" && v.storage !== "store")
    throw new TypeError("Invalid model registration storage");
  if (v.storage === "store" && (typeof v.store_id !== "string" || !v.store_id.trim()))
    throw new TypeError("Persistent model requires store_id");
  if (v.storage === "builtin" && v.store_id !== undefined)
    throw new TypeError("Builtin model must not have store_id");
  if (v.package_name !== undefined && v.package === undefined)
    throw new TypeError("package_name requires package");
  if (v.tags !== undefined && (!Array.isArray(v.tags) || v.tags.some(t => typeof t !== "string" || !t.trim()) || new Set(v.tags).size !== v.tags.length))
    throw new TypeError("Invalid model registration tags");
}
