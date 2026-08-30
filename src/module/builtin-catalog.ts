export type BuiltinRouteGrant = Readonly<{
  id: string;
  path: string;
  aliases?: readonly string[];
}>;

export type BuiltinModuleCatalogEntry = Readonly<{
  moduleId: string;
  instanceId: string;
  packageDirectory: string;
  routes: readonly BuiltinRouteGrant[];
}>;

export const builtinModuleCatalog: readonly BuiltinModuleCatalogEntry[] = deepFreeze([
  {
    moduleId: "org.memsphere.memory",
    instanceId: "memory",
    packageDirectory: "org.memsphere.memory",
    routes: [
      { id: "home", path: "/" },
      { id: "index", path: "/memories" },
      { id: "market", path: "/market", aliases: ["/memory-market"] },
      { id: "memory-detail", path: "/memories/:kind/:name" },
      { id: "project-index", path: "/projects/:projectId/memories" },
      { id: "project-memory-detail", path: "/projects/:projectId/memories/:kind/:name" },
      { id: "project-market", path: "/projects/:projectId/market" },
      { id: "change-detail", path: "/projects/:projectId/changes/:changeId" }
    ]
  },
  {
    moduleId: "org.memsphere.run",
    instanceId: "run",
    packageDirectory: "org.memsphere.run",
    routes: [
      { id: "index", path: "/tasks" },
      { id: "detail", path: "/tasks/:runId" },
      { id: "artifact-review", path: "/tasks/:runId/artifact-reviews/:reviewId" }
    ]
  },
  {
    moduleId: "org.memsphere.settings",
    instanceId: "settings",
    packageDirectory: "org.memsphere.settings",
    routes: [
      { id: "section", path: "/settings/:module" }
    ]
  }
]);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
