import type { MemoryCatalog } from "../memory/catalog.js";
import { createMemoryCatalog } from "../memory/factory.js";
import { isMemoryKind, memoryKinds, type MemoryKind } from "../memory/kinds.js";
import {
  serializeMemoryJson,
  serializeMemoryListJson,
  serializeMemoryListText,
  serializeMemoryListYaml,
  serializeMemoryNodeListJson,
  serializeMemoryNodeListText,
  serializeMemoryNodeListYaml,
  serializeMemoryNodeReadJson,
  serializeMemoryNodeReadYaml,
  serializeMemoryYaml
} from "../memory/serializer.js";
import { MemoryNavigation, type MemoryIdentity } from "../memory/navigation.js";

const listOutputs = ["yaml", "json", "text"] as const;
const readOutputs = ["yaml", "json"] as const;

type ListOutput = (typeof listOutputs)[number];
type ReadOutput = (typeof readOutputs)[number];

export type MemoryListCommandOptions = {
  kind?: string;
  query?: string;
  node?: string;
  output?: string;
};

export type MemoryReadCommandOptions = {
  kind?: string;
  node?: string;
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
  reference: string | undefined,
  options: MemoryListCommandOptions,
  dependencies: MemoryCommandDependencies = defaultDependencies
): Promise<void> {
  const kind = parseKind(options.kind);
  const output = parseOutput(options.output ?? "yaml", listOutputs, "memory list");
  if (!reference && options.node !== undefined) {
    throw new Error("memory list --node requires a memory reference");
  }
  if (reference && options.query) {
    throw new Error("memory list --query cannot be used with a memory reference");
  }
  const catalog = await dependencies.createCatalog();
  if (reference) {
    const descriptor = await catalog.resolve(reference, { kind });
    const entity = await catalog.read(descriptor.reference, { kind: descriptor.kind });
    const navigation = new MemoryNavigation(toIdentity(descriptor), entity);
    const page = navigation.listChildren(options.node);
    const value = output === "json"
      ? serializeMemoryNodeListJson(page)
      : output === "text"
        ? serializeMemoryNodeListText(page)
        : serializeMemoryNodeListYaml(page);
    dependencies.writeStdout(value);
    return;
  }
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
  if (options.node !== undefined) {
    const descriptor = await catalog.resolve(reference, { kind });
    const entity = await catalog.read(descriptor.reference, { kind: descriptor.kind });
    const result = new MemoryNavigation(toIdentity(descriptor), entity).readNode(options.node);
    const value = output === "json" ? serializeMemoryNodeReadJson(result) : serializeMemoryNodeReadYaml(result);
    dependencies.writeStdout(value);
    return;
  }
  const entity = await catalog.read(reference, { kind });
  const value = output === "json" ? serializeMemoryJson(entity) : serializeMemoryYaml(entity);
  dependencies.writeStdout(value);
}

function toIdentity(descriptor: { reference: string; kind: MemoryKind; names: string[] }): MemoryIdentity {
  return {
    reference: descriptor.reference,
    kind: descriptor.kind,
    names: [...descriptor.names]
  };
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
