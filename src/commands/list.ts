import { readConfig } from "../config.js";
import { isMemoryKind, memoryKinds, type MemoryKind } from "../memory/kinds.js";
import { readAllMemoryFiles } from "../memory/store.js";

export async function listCommand(kindArg?: string): Promise<void> {
  let kind: MemoryKind | undefined;

  if (kindArg) {
    if (!isMemoryKind(kindArg)) {
      throw new Error(`unknown memory kind "${kindArg}". Expected one of: ${memoryKinds.join(", ")}`);
    }

    kind = kindArg;
  }

  const config = await readConfig();
  const files = await readAllMemoryFiles(config.memoryRoot, kind);

  if (files.length === 0) {
    console.log("No memory entities found.");
    return;
  }

  for (const file of files) {
    const primaryName = file.entity.names[0];
    const aliases = file.entity.names.slice(1);
    const aliasText = aliases.length > 0 ? ` (${aliases.join(", ")})` : "";

    console.log(`${file.kind}/${primaryName}${aliasText}`);
  }
}
