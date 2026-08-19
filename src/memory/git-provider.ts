import type { MemoryEntity } from "./ast.js";
import { gitOutput } from "../git.js";
import { isMemoryKind, type MemoryKind } from "./kinds.js";
import { parseMemoryEntity } from "./store.js";
import { assertExpectedTag, parseMemoryYaml } from "./yaml.js";
import type { MemoryProvider, MemoryProviderQuery, ProviderMemoryDescriptor } from "./provider.js";

export class GitRevisionMemoryProvider implements MemoryProvider {
  readonly #root: string;
  readonly #revision: string;
  readonly #entities = new Map<string, MemoryEntity>();

  constructor(root: string, revision: string) {
    this.#root = root;
    this.#revision = revision;
  }

  async list(query: MemoryProviderQuery = {}): Promise<ProviderMemoryDescriptor[]> {
    this.#entities.clear();
    const output = await gitOutput(["ls-tree", "-r", "--name-only", this.#revision], this.#root);
    const paths = output.split("\n").filter(Boolean).filter((path) => path.endsWith(".yaml") || path.endsWith(".yml"));
    const descriptors: ProviderMemoryDescriptor[] = [];
    for (const path of paths) {
      const kindName = path.split("/")[0];
      if (!isMemoryKind(kindName) || (query.kind && query.kind !== kindName)) continue;
      const kind = kindName as MemoryKind;
      const source = await gitOutput(["show", `${this.#revision}:${path}`], this.#root);
      const entity = parseMemoryEntity(kind, parseMemoryYaml(`${source}\n`));
      assertExpectedTag(entity, kind, path);
      this.#entities.set(path, entity);
      descriptors.push({ id: path, kind, names: [...entity.names], defines: structuredClone(entity.defines) });
    }
    return descriptors;
  }

  async read(id: string): Promise<MemoryEntity> {
    const entity = this.#entities.get(id);
    if (!entity) throw new Error("memory provider id was not returned by the current list operation");
    return entity;
  }
}
