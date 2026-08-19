import type { MemoryEntity } from "./ast.js";
import { FileMemoryProvider } from "./file-provider.js";
import { GitRevisionMemoryProvider } from "./git-provider.js";
import type { MemoryProvider, MemoryProviderQuery, ProviderMemoryDescriptor } from "./provider.js";
import { gitOutput } from "../git.js";

export type ProjectMemorySource = {
  name: string;
  memoryRoot: string;
  revision?: string;
  managed?: { branch: string; publishedRevision: string };
};

export class ProjectMemoryProvider implements MemoryProvider {
  readonly #sources: Array<{ source: ProjectMemorySource; provider: MemoryProvider }>;
  readonly #owners = new Map<string, { provider: MemoryProvider; sourceId: string }>();

  constructor(sources: ProjectMemorySource[]) {
    this.#sources = sources.map((source) => ({
      source,
      provider: source.managed
        ? new GitRevisionMemoryProvider(source.memoryRoot, source.managed.publishedRevision)
        : new FileMemoryProvider(source.memoryRoot)
    }));
  }

  async list(query: MemoryProviderQuery = {}): Promise<ProviderMemoryDescriptor[]> {
    this.#owners.clear();
    const result: ProviderMemoryDescriptor[] = [];
    for (const { source, provider } of this.#sources) {
      const descriptors = await provider.list(query);
      const frozen = source.managed ? await frozenMemoryReferences(source, provider, descriptors) : new Set<string>();
      for (const descriptor of descriptors) {
        const id = `${source.name}\0${descriptor.id}`;
        this.#owners.set(id, { provider, sourceId: descriptor.id });
        result.push({
          ...descriptor,
          id,
          project_name: source.name,
          ...(source.revision ? { revision: source.revision } : {}),
          ...(frozen.has(logicalReference(descriptor)) ? { frozen: "formal Memory or one of its dependencies changed outside Memsphere" } : {})
        });
      }
    }
    return result;
  }

  async read(id: string): Promise<MemoryEntity> {
    const owner = this.#owners.get(id);
    if (!owner) throw new Error("memory provider id was not returned by the current list operation");
    return owner.provider.read(owner.sourceId);
  }
}

async function frozenMemoryReferences(
  source: ProjectMemorySource,
  provider: MemoryProvider,
  descriptors: ProviderMemoryDescriptor[]
): Promise<Set<string>> {
  if (!source.managed) return new Set();
  const managed = source.managed;
  const [branch, head, status] = await Promise.all([
    gitOutput(["branch", "--show-current"], source.memoryRoot),
    gitOutput(["rev-parse", "HEAD"], source.memoryRoot),
    gitOutput(["status", "--porcelain"], source.memoryRoot)
  ]);
  if (branch !== managed.branch || head !== managed.publishedRevision) {
    return new Set(descriptors.map(logicalReference));
  }
  if (!status) return new Set();
  const changedPaths = new Set(status.split("\n").flatMap((line) => line.slice(3).split(" -> ")));
  const frozen = new Set(descriptors.filter((descriptor) => changedPaths.has(descriptor.id)).map(logicalReference));
  const dependencies = new Map<string, Set<string>>();
  for (const descriptor of descriptors) {
    const owner = logicalReference(descriptor);
    const entity = await provider.read(descriptor.id);
    for (const target of collectReferences(entity)) {
      const dependents = dependencies.get(target) ?? new Set<string>();
      dependents.add(owner);
      dependencies.set(target, dependents);
    }
  }
  const queue = [...frozen];
  while (queue.length > 0) {
    for (const dependent of dependencies.get(queue.shift()!) ?? []) {
      if (frozen.has(dependent)) continue;
      frozen.add(dependent);
      queue.push(dependent);
    }
  }
  return frozen;
}

function logicalReference(descriptor: ProviderMemoryDescriptor): string {
  return `${descriptor.kind}/${descriptor.names[0]}`;
}

function collectReferences(value: unknown, result = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, result);
    return result;
  }
  if (!value || typeof value !== "object") return result;
  const record = value as Record<string, unknown>;
  if (record.tag === "!ref" && typeof record.target === "string") result.add(record.target);
  for (const item of Object.values(record)) collectReferences(item, result);
  return result;
}
