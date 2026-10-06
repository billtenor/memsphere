import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { commitModelOperation, optionalFileBytes, recoverModelOperation, withProjectModelWrite, withProjectSettingsLock } from "../../src/project/model-operation.js";

const root = process.argv[2];
const request = JSON.parse(process.argv[3]) as { mode: "write" | "recover" | "new-write"; pause?: string };
let resume!: () => void;
const continued = new Promise<void>(resolve => { resume = resolve; });
async function barrier(phase: string) {
  if (request.pause === phase) { process.send!({ type: "paused", phase }); await continued; }
}
const hooks = { afterPending: () => barrier("pending"), afterFile: (index: number) => barrier(`file-${index}`) };
process.on("message", async message => {
  if (message === "continue") { resume(); return; }
  if (message !== "start") return;
  try {
    if (request.mode === "recover") await withProjectSettingsLock(root, () => recoverModelOperation(root, hooks));
    else await withProjectModelWrite(root, async () => {
      if (request.mode === "new-write") {
        // The new request must see the restored definition before doing its own preflight.
        if ((await readFile(join(root, "models/json-schema/draft-07/existing.json"), "utf8")) !== "before\n") throw new Error("Preflight ran before recovery");
        const path = join(root, "models/json-schema/draft-07/new-request.json");
        await commitModelOperation(root, "model.create.new-request", [{ path, before: await optionalFileBytes(path), after: Buffer.from("new request\n") }]);
      } else {
        const paths = ["models/json-schema/draft-07/existing.json", "models/registrations/project/created.json", "config.json"];
        const changes = await Promise.all(paths.map(async (name, index) => {
          const path = join(root, name);
          return { path, before: await optionalFileBytes(path), after: Buffer.from(index === 2 ? '{"store":{"type":"managed","branch":"master","published_revision":"fixture"},"modelsDirectory":"models/json-schema/draft-07"}\n' : `after-${index}\n`) };
        }));
        await commitModelOperation(root, "model.update.interrupted", changes, hooks);
      }
    });
    process.send!({ type: "result", ok: true });
  } catch (cause) {
    const error = cause as Error & { code?: string };
    process.send!({ type: "result", ok: false, code: error.code, message: error.message });
  } finally { process.disconnect(); }
});
process.send!({ type: "ready" });
