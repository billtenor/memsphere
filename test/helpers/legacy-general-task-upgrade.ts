import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type Historical = { path: string; reference: string; sha256: string; source: string };
export const root = join(process.cwd(), "test/fixtures/legacy-general-task");
export const historical = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as Historical[];
