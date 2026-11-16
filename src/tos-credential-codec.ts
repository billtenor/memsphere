import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { validateCredentials, type TosCredentials } from "./data/extensions/tos-datastore/config.js";

export const tosCredentialVaultSchema = z.object({
  key: z.string().min(1),
  entries: z.record(z.string().min(1), z.object({ iv: z.string().min(1), tag: z.string().min(1), ciphertext: z.string().min(1) }).strict())
}).strict();
export type TosCredentialVault = z.infer<typeof tosCredentialVaultSchema>;

export function encryptTosCredential(id: string, credentials: TosCredentials, previous?: TosCredentialVault): TosCredentialVault {
  const vault: TosCredentialVault = previous ? structuredClone(previous) : { key: randomBytes(32).toString("base64"), entries: {} };
  const key = Buffer.from(vault.key, "base64");
  if (key.length !== 32) throw new Error("Invalid TOS credential encryption key");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(id));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(validateCredentials(credentials)), "utf8"), cipher.final()]);
  Object.defineProperty(vault.entries, id, { value: { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") }, enumerable: true, writable: true, configurable: true });
  return vault;
}
export function decryptTosCredential(id: string, vault: TosCredentialVault | undefined): TosCredentials {
  try {
    if (!vault || !Object.hasOwn(vault.entries, id)) throw new Error();
    const entry = vault.entries[id], key = Buffer.from(vault.key, "base64"), iv = Buffer.from(entry.iv, "base64"), tag = Buffer.from(entry.tag, "base64");
    if (key.length !== 32 || iv.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(id)); decipher.setAuthTag(tag);
    return validateCredentials(JSON.parse(Buffer.concat([decipher.update(Buffer.from(entry.ciphertext, "base64")), decipher.final()]).toString("utf8")) as TosCredentials);
  } catch { throw Object.assign(new Error("TOS credential is missing or cannot be decrypted"), { code: "TOS_CREDENTIALS_ERROR" }); }
}
