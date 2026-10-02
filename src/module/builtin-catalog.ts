export type BuiltinRouteGrant = Readonly<{
  id: string;
  path: string;
  aliases?: readonly string[];
  query?: readonly string[];
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
    homeRouteId: "project-index",
    routes: [
      { id: "index", path: "/memories", query: ["section", "change"] },
      { id: "market", path: "/market", aliases: ["/memory-market"], query: ["item"] },
      { id: "memory-detail", path: "/memories/:kind/:name", query: ["section", "change"] },
      { id: "project-index", path: "/projects/:projectId/memories", query: ["section", "change"] },
      { id: "project-memory-detail", path: "/projects/:projectId/memories/:kind/:name", query: ["section", "change"] },
      { id: "project-market", path: "/projects/:projectId/market", query: ["item"] },
      { id: "change-detail", path: "/projects/:projectId/changes/:changeId", query: ["section"] }
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
      { id: "index", path: "/tasks", query: ["status"] },
      { id: "detail", path: "/tasks/:runId", query: ["status"] },
      { id: "artifact-review", path: "/tasks/:runId/artifact-reviews/:reviewId", query: ["status", "round", "material"] }
    ]
  },
  {
    moduleId: "org.memsphere.models",
    instanceId: "models",
    packageDirectory: "org.memsphere.models",
    title: "模型",
    summary: "浏览项目模型定义",
    icon: "stack",
    homeRouteId: "index",
    routes: [{ id: "index", path: "/models", query: ["model"] }]
  },
  {
    moduleId: "org.memsphere.model-prototype",
    instanceId: "model-prototype",
    packageDirectory: "org.memsphere.model-prototype",
    title: "模型原型",
    summary: "模型列表、定义与项目存储配置的产品原型",
    icon: "stack",
    homeRouteId: "index",
    routes: [
      { id: "index", path: "/model-prototype", query: ["model"] },
      { id: "storage", path: "/model-prototype/storage" }
    ]
  },
  {
    moduleId: "org.memsphere.reference",
    instanceId: "reference",
    packageDirectory: "org.memsphere.reference",
    title: "原型",
    summary: "验证 View Framework 标准壳与自由业务正文",
    icon: "sparkle",
    homeRouteId: "index",
    routes: [
      { id: "index", path: "/reference", query: ["item"] },
      { id: "dialog", path: "/reference/dialog" },
      { id: "drawer", path: "/reference/drawer" }
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
