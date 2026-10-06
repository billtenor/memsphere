import { readConfig } from "../config.js";
import { dirname, resolve } from "node:path";
import { DefaultMemoryCatalog, type MemoryCatalog } from "./catalog.js";
import { FileMemoryProvider } from "./file-provider.js";
import { ProjectMemoryProvider } from "./project-provider.js";
import type { MemoryProvider } from "./provider.js";

export type PrimaryMemoryCatalogOverride = {
  memoryRoot: string;
  revision: string;
  provider?: MemoryProvider;
  runId?: string;
};

export async function createMemoryCatalog(): Promise<MemoryCatalog> {
  const config = await readConfig();
  return createMemoryCatalogForConfig(config);
}

export function createMemoryCatalogForConfig(
  config: Awaited<ReturnType<typeof readConfig>>,
  primaryOverride?: PrimaryMemoryCatalogOverride
): MemoryCatalog {
  if (!config.project) {
    const root = primaryOverride?.memoryRoot ?? config.memoryRoot;
    return new DefaultMemoryCatalog(primaryOverride?.provider ?? new FileMemoryProvider(root), {
      memoryRoot: resolve(root), run: primaryOverride?.runId
    });
  }
  const sources = projectSources(config, primaryOverride);
  return new DefaultMemoryCatalog(new ProjectMemoryProvider(sources), catalogScope(sources, primaryOverride));
}

export function createProjectMemoryCatalogs(
  config: Awaited<ReturnType<typeof readConfig>>,
  primaryOverride?: PrimaryMemoryCatalogOverride
): Record<string, MemoryCatalog> {
  if (!config.project) return {};
  return Object.fromEntries(projectSources(config, primaryOverride).map((source) => [
    source.name,
    new DefaultMemoryCatalog(new ProjectMemoryProvider([source]), catalogScope([source], primaryOverride))
  ]));
}

function catalogScope(sources: Array<{ name: string; memoryRoot: string }>, override?: PrimaryMemoryCatalogOverride) {
  return {
    projects: sources.map(({ name, memoryRoot }) => ({ name, memoryRoot: resolve(memoryRoot) }))
      .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    run: override?.runId
  };
}

function projectSources(
  config: Awaited<ReturnType<typeof readConfig>>,
  primaryOverride?: PrimaryMemoryCatalogOverride
) {
  if (!config.project) return [];
  return [
    {
      name: config.project.name,
      projectRoot: primaryOverride ? undefined : dirname(config.configPath),
      memoryRoot: primaryOverride?.memoryRoot ?? config.memoryRoot,
      revision: primaryOverride?.revision ?? config.project.revision,
      provider: primaryOverride?.provider,
      managed: !primaryOverride && config.project.store?.type === "managed" ? {
        branch: config.project.store.branch,
        publishedRevision: config.project.store.published_revision
      } : undefined
    },
    ...config.project.mounted.map((project) => ({
      name: project.name,
      projectRoot: project.root,
      memoryRoot: project.memoryRoot,
      revision: project.revision,
      managed: project.store.type === "managed" ? {
        branch: project.store.branch,
        publishedRevision: project.store.published_revision
      } : undefined
    }))
  ];
}
