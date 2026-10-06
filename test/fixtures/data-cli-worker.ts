import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const request = JSON.parse(process.argv[2]) as { args: string[]; recordPath: string; pauseRead?: boolean };
if (request.pauseRead) request.recordPath = await fs.realpath(request.recordPath);
const native = createRequire(import.meta.url)("fs-native-extensions");
const tryLock = native.tryLock;
let reportedWaiting = false;
native.tryLock = (...args: unknown[]) => {
  const locked = tryLock(...args);
  if (!locked && !reportedWaiting) { reportedWaiting = true; process.send!({ type: "waiting" }); }
  return locked;
};
let release!: () => void;
const released = new Promise<void>((resolve) => { release = resolve; });
let captured = false;
const open = fs.open.bind(fs);
fs.open = async (...args) => {
  const handle = await open(...args);
  if (request.pauseRead && String(args[0]) === request.recordPath) {
    const readFile = handle.readFile.bind(handle);
    handle.readFile = (async (...readArgs: Parameters<typeof readFile>) => {
      const bytes = await readFile(...readArgs);
      if (!captured) {
        captured = true;
        process.send!({ type: "captured" });
        await released;
      }
      return bytes;
    }) as typeof handle.readFile;
  }
  return handle;
};
process.on("message", async (message) => {
  if (message === "continue") { release(); return; }
  if (message !== "start") return;
  process.argv = [process.execPath, fileURLToPath(new URL("../../src/cli.ts", import.meta.url)), ...request.args];
  await import("../../src/cli.js");
  process.disconnect();
});
process.send!({ type: "ready" });
