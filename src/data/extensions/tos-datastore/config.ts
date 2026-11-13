import type { Config, JsonObject } from "../../api/config.js";
import { validateRelativeFilePath } from "../shared/filesystem.js";

export type TosCredentials = { accessKeyId: string; accessKeySecret: string; stsToken?: string };
export type TosCredentialReference =
  | { source: "settings"; id: string }
  | { source: "env"; accessKeyIdEnv: string; accessKeySecretEnv: string; stsTokenEnv?: string };
export type TosConfig = { region: string; endpoint: string; bucket: string; prefix: string; mode: "raw" | "revision"; credentials: TosCredentialReference };
export type TosCredentialsResolver = (reference: TosCredentialReference) => Promise<TosCredentials>;

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.length || value.trim() !== value) throw new TypeError(`Invalid TOS ${field}`);
  return value;
}
function fields(value: JsonObject, allowed: string[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new TypeError(`Unknown TOS configuration field: ${key}`);
}

export function parseTosConfig(config: Config): TosConfig {
  const raw = config.json;
  fields(raw, ["region", "endpoint", "bucket", "prefix", "mode", "credentials"]);
  const region = text(raw.region, "region"), endpoint = text(raw.endpoint, "endpoint"), bucket = text(raw.bucket, "bucket"), prefix = text(raw.prefix, "prefix");
  if (!/^[a-z][a-z0-9-]+$/.test(region) || ![`tos-${region}.volces.com`, `tos-${region}.ivolces.com`].includes(endpoint)) throw new TypeError("Invalid native TOS region/endpoint");
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new TypeError("Invalid TOS bucket");
  if (Buffer.byteLength(prefix, "utf8") >= 1024) throw new TypeError("TOS prefix leaves no room for a record key");
  if (!prefix.endsWith("/")) throw new TypeError("TOS prefix must end with /");
  validateRelativeFilePath(prefix.slice(0, -1));
  if (raw.mode !== "raw" && raw.mode !== "revision") throw new TypeError("TOS mode must be raw or revision");
  const ref = raw.credentials;
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) throw new TypeError("TOS credentials reference is required");
  let credentials: TosCredentialReference;
  if (ref.source === "settings") {
    fields(ref, ["source", "id"]); credentials = { source: "settings", id: text(ref.id, "credential id") };
  } else if (ref.source === "env") {
    fields(ref, ["source", "accessKeyIdEnv", "accessKeySecretEnv", "stsTokenEnv"]);
    credentials = { source: "env", accessKeyIdEnv: text(ref.accessKeyIdEnv, "accessKeyIdEnv"), accessKeySecretEnv: text(ref.accessKeySecretEnv, "accessKeySecretEnv"),
      ...(ref.stsTokenEnv === undefined ? {} : { stsTokenEnv: text(ref.stsTokenEnv, "stsTokenEnv") }) };
    for (const name of [credentials.accessKeyIdEnv, credentials.accessKeySecretEnv, credentials.stsTokenEnv].filter((s): s is string => !!s)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new TypeError("Invalid credential environment variable name");
    }
  } else throw new TypeError("TOS credential source must be env or settings");
  return { region, endpoint, bucket, prefix, mode: raw.mode, credentials };
}

export async function resolveEnvironmentCredentials(reference: TosCredentialReference): Promise<TosCredentials> {
  if (reference.source !== "env") throw new Error("Settings credentials require a host resolver");
  return validateCredentials({ accessKeyId: process.env[reference.accessKeyIdEnv] ?? "", accessKeySecret: process.env[reference.accessKeySecretEnv] ?? "",
    ...(reference.stsTokenEnv ? { stsToken: process.env[reference.stsTokenEnv] } : {}) });
}
export function validateCredentials(credentials: TosCredentials): TosCredentials {
  // Never include a value in diagnostics.
  text(credentials.accessKeyId, "accessKeyId"); text(credentials.accessKeySecret, "accessKeySecret");
  if (credentials.stsToken !== undefined) text(credentials.stsToken, "stsToken");
  return { ...credentials };
}
