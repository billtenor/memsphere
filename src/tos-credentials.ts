import { homePaths, resolveMemsphereHome } from "./home.js";
import { withConfigFileLock } from "./config-file-lock.js";
import { readGlobalConfigDocument, ConfigRevisionConflictError } from "./config-management.js";
import { atomicWriteJson } from "./persistence.js";
import { encryptTosCredential, decryptTosCredential } from "./tos-credential-codec.js";
import { resolveEnvironmentCredentials, type TosCredentials, type TosCredentialReference } from "./data/extensions/tos-datastore/config.js";

export async function resolveTosCredentials(reference: TosCredentialReference): Promise<TosCredentials> {
  if (reference.source === "env") return resolveEnvironmentCredentials(reference);
  const document = await readGlobalConfigDocument(homePaths(resolveMemsphereHome()).configPath);
  return decryptTosCredential(reference.id, document.raw.tosCredentials);
}

/** Public settings surface exposes ids and a revision, never the vault or key. */
export async function listTosCredentials(configPath: string) {
  const document = await readGlobalConfigDocument(configPath);
  return { revision: document.revision, items: Object.keys(document.raw.tosCredentials?.entries ?? {}).sort().map(id => ({ id })) };
}
export async function saveTosCredential(configPath: string, id: string, credentials: TosCredentials, expectedRevision: string) {
  if (!id || id.trim() !== id || id.length > 128 || id === "__proto__" || /[\x00-\x1f]/.test(id)) throw new TypeError("Invalid TOS credential id");
  await withConfigFileLock(configPath, async () => {
    const document = await readGlobalConfigDocument(configPath);
    if (document.revision !== expectedRevision) throw new ConfigRevisionConflictError(expectedRevision, document.revision);
    const previous = document.raw.tosCredentials?.entries && Object.hasOwn(document.raw.tosCredentials.entries, id)
      ? decryptTosCredential(id, document.raw.tosCredentials) : undefined;
    const replacement = {
      accessKeyId: credentials.accessKeyId || previous?.accessKeyId || "",
      accessKeySecret: credentials.accessKeySecret || previous?.accessKeySecret || "",
      ...((credentials.stsToken || previous?.stsToken) ? { stsToken: credentials.stsToken || previous?.stsToken } : {})
    };
    const tosCredentials = encryptTosCredential(id, replacement, document.raw.tosCredentials);
    await atomicWriteJson(configPath, { ...document.raw, tosCredentials });
  });
  return listTosCredentials(configPath);
}
