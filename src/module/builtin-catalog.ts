export type BuiltinRouteGrant = Readonly<{
  id: string;
  path: string;
  aliases?: readonly string[];
}>;

export type BuiltinModuleCatalogEntry = Readonly<{
  moduleId: string;
  instanceId: string;
  packageDirectory: string;
  title: string;
  summary: string;
  icon: string;
  homeRouteId: string;
  routes: readonly BuiltinRouteGrant[];
}>;

export const builtinModuleCatalog: readonly BuiltinModuleCatalogEntry[] = deepFreeze([
  {
    moduleId: "org.memsphere.memory",
    instanceId: "memory",
    packageDirectory: "org.memsphere.memory",
    title: "记忆",
    summary: "组织与维护项目记忆",
    icon: "brain",
    homeRouteId: "index",
    routes: [
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
    title: "运行",
    summary: "执行流程并跟踪产物",
    icon: "play-circle",
    homeRouteId: "index",
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
    title: "设置",
    summary: "配置 Memsphere 与项目",
    icon: "gear",
    homeRouteId: "section",
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
