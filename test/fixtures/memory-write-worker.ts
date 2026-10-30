import { withMemoryWriteAccess } from "../../src/memory/write-access.js";
process.once("message", async () => {
  try {
    await withMemoryWriteAccess(process.argv[2], async () => {
      process.send!({ type: "claimed" });
      await new Promise<void>(resolve => process.once("message", () => resolve()));
    });
    process.send!({ type: "done" });
  } catch (error) { process.send!({ type: "failed", message: String(error) }); }
  process.disconnect();
});
process.send!({ type: "ready" });
