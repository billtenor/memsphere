import { readConfig } from "../config.js";
import { dirname } from "node:path";
import { DefaultMemoryCatalog, type MemoryCatalog } from "./catalog.js";
import { FileMemoryProvider } from "./file-provider.js";
import { ProjectMemoryProvider } from "./project-provider.js";
import type { MemoryProvider } from "./provider.js";

export type PrimaryMemoryCatalogOverride = {
  memoryRoot: string;
  revision: string;
  provider?: MemoryProvider;
};

export async function createMemoryCatalog(): Promise<MemoryCatalog> {
  const config = await readConfig();
  return createMemoryCatalogForConfig(config);
}

export function createMemoryCatalogForConfig(
  config: Awaited<ReturnType<typeof readConfig>>,
  primaryOverride?: PrimaryMemoryCatalogOverride
): MemoryCatalog {
  if (!config.project) return new DefaultMemoryCatalog(primaryOverride?.provider ?? new FileMemoryProvider(primaryOverride?.memoryRoot ?? config.memoryRoot));
  return new DefaultMemoryCatalog(new ProjectMemoryProvider(projectSources(config, primaryOverride)));
}

export function createProjectMemoryCatalogs(
  config: Awaited<ReturnType<typeof readConfig>>,
  primaryOverride?: PrimaryMemoryCatalogOverride
): Record<string, MemoryCatalog> {
  if (!config.project) return {};
  return Object.fromEntries(projectSources(config, primaryOverride).map((source) => [
    source.name,
    new DefaultMemoryCatalog(new ProjectMemoryProvider([source]))
  ]));
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
