import type { MemoryCatalog } from "../memory/catalog.js";
import { createMemoryCatalog } from "../memory/factory.js";
import { isMemoryKind, memoryKinds, type MemoryKind } from "../memory/kinds.js";
import {
  serializeMemoryJson,
  serializeMemoryListJson,
  serializeMemoryListText,
  serializeMemoryListYaml,
  serializeMemoryYaml
} from "../memory/serializer.js";

const listOutputs = ["yaml", "json", "text"] as const;
const readOutputs = ["yaml", "json"] as const;

type ListOutput = (typeof listOutputs)[number];
type ReadOutput = (typeof readOutputs)[number];

export type MemoryListCommandOptions = {
  kind?: string;
  query?: string;
  output?: string;
};

export type MemoryReadCommandOptions = {
  kind?: string;
  output?: string;
};

export type MemoryCommandDependencies = {
  createCatalog: () => Promise<MemoryCatalog>;
  writeStdout: (value: string) => void;
};

const defaultDependencies: MemoryCommandDependencies = {
  createCatalog: createMemoryCatalog,
  writeStdout: (value) => process.stdout.write(value)
};

export async function memoryListCommand(
  options: MemoryListCommandOptions,
  dependencies: MemoryCommandDependencies = defaultDependencies
): Promise<void> {
  const kind = parseKind(options.kind);
  const output = parseOutput(options.output ?? "yaml", listOutputs, "memory list");
  const catalog = await dependencies.createCatalog();
  const page = await catalog.list({ kind, query: options.query });
  const value = output === "json"
    ? serializeMemoryListJson(page)
    : output === "text"
      ? serializeMemoryListText(page)
      : serializeMemoryListYaml(page);
  dependencies.writeStdout(value);
}

export async function memoryReadCommand(
  reference: string,
  options: MemoryReadCommandOptions,
  dependencies: MemoryCommandDependencies = defaultDependencies
): Promise<void> {
  const kind = parseKind(options.kind);
  const output = parseOutput(options.output ?? "yaml", readOutputs, "memory read");
  const catalog = await dependencies.createCatalog();
  const entity = await catalog.read(reference, { kind });
  const value = output === "json" ? serializeMemoryJson(entity) : serializeMemoryYaml(entity);
  dependencies.writeStdout(value);
}

function parseKind(value: string | undefined): MemoryKind | undefined {
  if (value === undefined) return undefined;
  if (!isMemoryKind(value)) {
    throw new Error(`unknown memory kind "${value}". Expected one of: ${memoryKinds.join(", ")}`);
  }
  return value;
}

function parseOutput<T extends string>(value: string, allowed: readonly T[], command: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`unknown ${command} output "${value}". Expected one of: ${allowed.join(", ")}`);
  }
  return value as T;
}
