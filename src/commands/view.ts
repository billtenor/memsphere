import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { gzipSync } from "node:zlib";
import { access, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import MarkdownIt from "markdown-it";
import { ZodError, type ZodIssue } from "zod";
import { builtinModuleCatalog } from "../module/builtin-catalog.js";
import { isViewSdkCompatible, readModuleManifest, resolveModuleViewEntry } from "../module/manifest.js";
import { archiveRun } from "../archive/store.js";
import { dispatchArtifactReviewAgents } from "../acp/dispatcher.js";
import { agentActivityDelta, readAgentActivitySnapshot } from "../acp/activity.js";
import { detectAcpProviderInstances } from "../acp/detection.js";
import {
  defaultAcpProviderInstance,
  defaultAcpProviderInstances,
  listAcpProviderDefinitions
} from "../acp/catalog.js";
import {
  artifactReviewAssignmentId,
  artifactReviewFailureCategory,
  artifactReviewOpinionReferencesImplementation,
  artifactReviewRoundControlPlane,
  repeatedArtifactReviewAdvisories,
  type ArtifactReviewAgentAttempt,
  type ArtifactReviewSubmittedOpinion,
  type ArtifactReviewVote
} from "../artifact-review.js";
import { type MemsphereConfig, readProjectConfig, readViewConfig } from "../config.js";
import { homePaths, resolveMemsphereHome } from "../home.js";
import { listRegisteredProjects } from "../project/registry.js";
import {
  ConfigDraftValidationError,
  ConfigRevisionConflictError,
  editableGlobalConfigDraft,
  editableProjectConfigDraft,
  parseProjectConfigSource,
  readGlobalConfigDocument,
  readProjectConfigDocument,
  validateGlobalConfigDraft,
  validateProjectConfigDraft,
  writeGlobalConfigDraft,
  writeGlobalOperatorToken,
  writeProjectConfigDraft,
  type EditableGlobalConfigDraft,
  type EditableProjectConfigDraft,
  type GlobalConfigDocument,
  type ProjectConfigDocument,
  type ProjectConfigReference
} from "../config-management.js";
import { authorizeArtifactOperation, controlPlaneConfigSchema, listPermissionDefinitions } from "../control-plane/index.js";
import { listMemoryFiles, readMemoryFile, readMemoryFileSummary } from "../memory/store.js";
import { memoryKinds, type MemoryKind } from "../memory/kinds.js";
import { parseMemoryYaml } from "../memory/yaml.js";
import { resolveRuleParts, type RuleLookup } from "../memory/rules.js";
import { toEffectiveRuleDisplayTree, toEffectiveRuleDisplayValue } from "../memory/serializer.js";
import {
  abandonMemoryChange,
  addMemoryChangeScope,
  archiveMemoryChange,
  createMemoryChangeComment,
  createMarketMemoryChange,
  createViewMemoryChange,
  deleteMemoryChangeComment,
  MemoryChangeIntegrityError,
  MemoryChangePreviewCache,
  listMemoryChangesBestEffort,
  readMemoryChange,
  updateMemoryChangeComment,
  withMemoryChangeDetailSnapshot,
  type MemoryChangeActor,
  type MemoryChangeSet
} from "../memory/changeset.js";
import { readBundledSystemMemories } from "../reserved/store.js";
import {
  countMemoryMarket,
  listMemoryMarket,
  MarketMemoryNameConflictError,
  planMemoryMarketImport
} from "../market/store.js";
import {
  abandonRun,
  ArtifactAuthorizationFailure,
  ArtifactReviewConflictError,
  artifactReviewForActor,
  buildRunBindingSnapshot,
  buildSchemaWritingSnapshot,
  currentArtifactReview,
  ensureCurrentSchemaDraft,
  findArtifactReview,
  listRuns,
  listRunSummaries,
  parseRunState,
  readArtifactReviewForActor,
  readRun,
  retryArtifactReviewAgentAssignment,
  resolveArtifactReviewComment,
  submitArtifactReviewAssignment,
  updateRunSlotBinding,
  updateArtifactReviewDraft,
  type ArtifactReviewDraftInput,
  type ArtifactReviewContext,
  type RunState,
  type RunStep
} from "../run/store.js";
import {
  renderViewHostHtml,
  viewRuntimeBundlePath,
  viewSdkBundlePath,
  type ViewHostBootInstance
} from "../view/host.js";
import { coreViewRoutes } from "../view/core-routes.js";
import {
  localizeAcpProviderDefinition,
  localizeAcpProviderDetection,
  resolveViewLocale
} from "../view/locales/index.js";
import {
  clearViewServiceState,
  getViewServiceStatus,
  restartViewService,
  createSettingsToken,
  isLoopbackHost,
  startViewService,
  stopViewService,
  viewServiceStatePath,
  viewServiceUrl,
  writeViewServiceState
} from "../view/service.js";

const markdown = createMarkdownRenderer();

type ViewServeOptions = {
  config?: string;
  state?: string;
};

type MemoryPayload = {
  memoryRoot: string;
  actorNames: Record<string, string>;
  actorKinds: Record<string, "human" | "agent">;
  source: {
    mode: "formal" | "changeset";
    changeId?: string;
    storeType?: "managed" | "embedded";
    baseRevision?: string;
    updatedAt?: string;
    valid?: boolean;
    issues?: Array<{ path: string; message: string; line?: number; column?: number }>;
  };
  memories: Array<{
    id: string;
    kind: string;
    path: string;
    system: boolean;
    names?: string[];
    entity?: unknown;
    error?: MemoryLoadError;
  }>;
};

type MemoryLoadError = {
  message: string;
  issues: string[];
};

export async function viewStartCommand(): Promise<void> {
  const config = await readViewStartupConfig();
  const state = await startViewService(config);
  console.log(`memsphere view running at ${viewServiceUrl(state)}`);
  console.log(`pid: ${state.pid}`);
  if (state.settingsToken) console.log(`settings token: ${state.settingsToken}`);
}

export async function viewStopCommand(): Promise<void> {
  const config = await readViewServiceConfig();
  const status = await stopViewService(config);
  console.log(status.running ? "memsphere view is still running" : "memsphere view stopped");
}

export async function viewRestartCommand(): Promise<void> {
  const config = await readViewStartupConfig();
  const state = await restartViewService(config);
  console.log(`memsphere view restarted at ${viewServiceUrl(state)}`);
  console.log(`pid: ${state.pid}`);
  if (state.settingsToken) console.log(`settings token: ${state.settingsToken}`);
}

export async function viewStatusCommand(): Promise<void> {
  const config = await readViewServiceConfig();
  const status = await getViewServiceStatus(config);
  if (!status.running || !status.state) {
    console.log("memsphere view stopped");
    return;
  }
  console.log(`memsphere view running at ${viewServiceUrl(status.state)}`);
  console.log(`pid: ${status.state.pid}`);
  console.log(`started: ${status.state.startedAt}`);
  if (status.state.settingsToken) console.log(`settings token: ${status.state.settingsToken}`);
}

export async function viewServeCommand(options: ViewServeOptions): Promise<void> {
  const config = await readViewConfig(options.config);
  const host = config.view.host;
  const port = config.view.port;
  const statePath = options.state ?? viewServiceStatePath(config);
  const runningDocument = await readGlobalSettingsDocument(config);
  const settingsToken = isLoopbackHost(host)
    ? undefined
    : config.view.operatorToken ?? createSettingsToken();
  const server = createViewServer(config, {
    runningRevision: runningDocument.revision,
    settingsToken
  });

  server.on("error", async (error) => {
    await clearViewServiceState(statePath, process.pid);
    console.error(`error: failed to start view server: ${error.message}`);
    process.exitCode = 1;
  });

  server.listen(port, host, async () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;
    await clearViewServiceState(statePath);
    await writeViewServiceState(statePath, {
      pid: process.pid,
      host,
      port: actualPort,
      startedAt: new Date().toISOString(),
      configPath: config.configPath,
      settingsToken
    });
    console.log(`memsphere view running at http://${host}:${actualPort}`);
    console.log(`memoryRoot: ${config.memoryRoot}`);
  });

  const close = async () => {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await clearViewServiceState(statePath, process.pid);
  };
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
}

export type ViewDevelopmentModule = Readonly<{
  assetPath: `/assets/dev-modules/${string}.js`;
  source: string;
  instance: ViewHostBootInstance;
  pagePaths: readonly string[];
}>;

type ViewServerOptions = {
  runningRevision?: string;
  settingsToken?: string;
  developmentModules?: readonly ViewDevelopmentModule[];
};

class ViewMemoryCache {
  readonly previews = new MemoryChangePreviewCache();
  readonly #filesByRoot = new Map<string, Map<string, { kind: MemoryKind; path: string }>>();

  replaceIndex(memoryRoot: string, files: Map<string, { kind: MemoryKind; path: string }>): void {
    this.#filesByRoot.set(memoryRoot, files);
  }

  async find(memoryRoot: string, memoryId: string): Promise<{ kind: MemoryKind; path: string } | undefined> {
    const cached = this.#filesByRoot.get(memoryRoot)?.get(memoryId);
    if (cached) {
      try {
        const summary = await readMemoryFileSummary(cached.kind, cached.path);
        if (`${summary.kind}/${summary.names[0]}` === memoryId) return cached;
      } catch {
        // Rebuild below if a formal Memory changed after its summary was loaded.
      }
    }
    const rebuilt = await buildMemoryFileIndex(memoryRoot);
    this.#filesByRoot.set(memoryRoot, rebuilt);
    return rebuilt.get(memoryId);
  }

  async clear(): Promise<void> {
    this.#filesByRoot.clear();
    await this.previews.clear();
  }

  async dispose(): Promise<void> {
    this.#filesByRoot.clear();
    await this.previews.dispose();
  }
}

export function createViewServer(config: MemsphereConfig, options: ViewServerOptions = {}) {
  for (const module of options.developmentModules ?? []) {
    if (!/^\/assets\/dev-modules\/[a-z0-9._-]+\.js$/.test(module.assetPath)) {
      throw new Error(`Invalid development Module asset path: ${module.assetPath}`);
    }
    if (module.instance.pluginPath !== module.assetPath) {
      throw new Error(`Development Module instance asset mismatch: ${module.instance.module.moduleId}`);
    }
    if (module.pagePaths.some(path => !path.startsWith("/") || path.includes(".."))) {
      throw new Error(`Invalid development Module page path: ${module.instance.module.moduleId}`);
    }
  }
  const viewCache = new ViewMemoryCache();
  void systemMemoryReferences().catch(() => {
    systemMemoryReferencesPromise = undefined;
  });
  const server = createServer(async (request, response) => {
    try {
      await handleRequest(request, response, config, options, viewCache);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, {
        ...(error instanceof MemoryChangeIntegrityError ? { code: error.code } : {}),
        error: message
      });
    }
  });
  server.once("close", () => void viewCache.dispose());
  return server;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: MemsphereConfig,
  options: ViewServerOptions,
  viewCache: ViewMemoryCache
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const { memoryRoot, runsRoot } = config;
  const archiveRoot = config.archiveRoot;

  if (request.method === "GET" && url.pathname === viewSdkBundlePath) {
    sendJavaScript(request, response, await readCompiledBrowserModule(compiledViewSdkUrl, sourceViewSdkUrl));
    return;
  }

  if (request.method === "GET" && url.pathname === viewRuntimeBundlePath) {
    sendJavaScript(request, response, await readCompiledBrowserModule(compiledViewRuntimeUrl, sourceViewRuntimeUrl));
    return;
  }

  const runtimeDependency = viewRuntimeDependencies.get(url.pathname);
  if (request.method === "GET" && runtimeDependency) {
    sendJavaScript(request, response, await readCompiledBrowserModule(runtimeDependency.compiled, runtimeDependency.source));
    return;
  }

  const systemIcon = url.pathname.match(/^\/assets\/system-icons\/([a-z0-9-]+)\.svg$/)?.[1];
  if (request.method === "GET" && systemIcon) {
    await sendSystemIcon(response, systemIcon);
    return;
  }

  const builtinAsset = builtinModuleAsset(url.pathname);
  if (request.method === "GET" && builtinAsset) {
    sendJavaScript(request, response, await readBuiltinViewBundle(builtinAsset.packageDirectory, builtinAsset.moduleId));
    return;
  }

  const developmentAsset = options.developmentModules?.find(module => module.assetPath === url.pathname);
  if (request.method === "GET" && developmentAsset) {
    sendJavaScript(request, response, developmentAsset.source);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/projects") {
    const projects = await listRegisteredProjects(config.homeRoot ?? resolveMemsphereHome());
    sendJson(response, 200, {
      current: config.project?.name,
      projects,
      currentProject: config.project ? {
        name: config.project.name,
        root: config.scopeRoot,
        storeType: config.project.store?.type,
        revision: config.project.revision,
        memoryRoot: config.memoryRoot
      } : undefined
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/projects/select") {
    const body = await readJsonBody<{ name?: unknown }>(request);
    if (typeof body.name !== "string" || !body.name.trim()) {
      sendJson(response, 400, { error: "Project name is required" });
      return;
    }
    const selected = await readProjectConfig(body.name.trim(), config.homeRoot);
    await viewCache.clear();
    Object.assign(config, selected);
    sendJson(response, 200, { current: selected.project?.name });
    return;
  }

  const developmentPage = options.developmentModules?.some(module => module.pagePaths.includes(url.pathname)) === true;
  if (request.method === "GET" && (isViewPagePath(url.pathname) || developmentPage)) {
    const instances = await builtinViewInstances(config);
    sendHtml(response, renderViewHostHtml(
      config.language,
      [...instances, ...(options.developmentModules?.map(module => module.instance) ?? [])],
      url.pathname,
    ));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/settings/meta") {
    const document = await readGlobalSettingsDocument(config);
    sendJson(response, 200, {
      requiresToken: !isLoopbackHost(config.view.host),
      operatorTokenConfigured: Boolean(document.raw.view?.operator_token),
      host: config.view.host,
      port: config.view.port
    });
    return;
  }

  if (url.pathname === "/api/settings/global/operator-token" && request.method === "PUT") {
    if (!authorizeSettingsRequest(request, response, config, options, true)) return;
    const body = await readJsonBody<{ expectedRevision?: unknown; token?: unknown }>(request, 16 * 1024);
    if (typeof body.expectedRevision !== "string" || (body.token !== null && typeof body.token !== "string")) {
      sendJson(response, 400, { code: "invalid_request", error: "expectedRevision and token are required" });
      return;
    }
    const token = typeof body.token === "string" ? body.token.trim() : undefined;
    if (token !== undefined && !token) {
      sendJson(response, 422, {
        code: "config_invalid",
        error: "Operation token must not be empty"
      });
      return;
    }
    const document = await readGlobalSettingsDocument(config);
    try {
      const saved = await writeGlobalOperatorToken({
        document,
        expectedRevision: body.expectedRevision,
        ...(token ? { token } : {})
      });
      sendJson(response, 200, {
        diskRevision: saved.revision,
        operatorTokenConfigured: Boolean(saved.raw.view?.operator_token),
        restartRequired: true
      });
    } catch (error) {
      if (error instanceof ConfigRevisionConflictError) {
        sendJson(response, 409, {
          code: "revision_conflict",
          error: error.message,
          expectedRevision: error.expectedRevision,
          actualRevision: error.actualRevision
        });
        return;
      }
      if (error instanceof ZodError) {
        sendJson(response, 422, { code: "config_invalid", error: error.issues[0]?.message ?? "Invalid token" });
        return;
      }
      throw error;
    }
    return;
  }

  if (url.pathname === "/api/settings/global" && request.method === "GET") {
    if (!authorizeSettingsRequest(request, response, config, options)) return;
    const document = await readGlobalSettingsDocument(config);
    const projects = await readRegisteredProjectConfigs(config.homeRoot);
    sendJson(response, 200, globalSettingsPayload(
      document,
      options.runningRevision ?? document.revision,
      config.view,
      projects
    ));
    return;
  }

  if (url.pathname === "/api/settings/global/validate" && request.method === "POST") {
    if (!authorizeSettingsRequest(request, response, config, options, true)) return;
    const body = await readJsonBody<{ expectedRevision?: unknown; config?: unknown }>(request, 128 * 1024);
    if (typeof body.expectedRevision !== "string" || !body.config || typeof body.config !== "object") {
      sendJson(response, 400, { code: "invalid_request", error: "expectedRevision and config are required" });
      return;
    }
    const document = await readGlobalSettingsDocument(config);
    if (document.revision !== body.expectedRevision) {
      sendJson(response, 409, {
        code: "revision_conflict",
        error: "config file changed on disk",
        expectedRevision: body.expectedRevision,
        actualRevision: document.revision
      });
      return;
    }
    const validation = validateGlobalConfigDraft(
      document,
      body.config as EditableGlobalConfigDraft,
      await readRegisteredProjectConfigs(config.homeRoot)
    );
    const { candidate: _candidate, ...publicValidation } = validation;
    const candidateView = validation.candidate?.view ?? { host: "127.0.0.1", port: 0 };
    sendJson(response, validation.valid ? 200 : 422, {
      ...publicValidation,
      expectedRevision: document.revision,
      runningRevision: options.runningRevision ?? document.revision,
      restartRequired: !sameViewConfig(candidateView, config.view)
    });
    return;
  }

  if (url.pathname === "/api/settings/global/acp-providers/detect" && request.method === "POST") {
    if (!authorizeSettingsRequest(request, response, config, options, true)) return;
    const body = await readJsonBody<{ expectedRevision?: unknown; config?: unknown }>(request, 128 * 1024);
    if (typeof body.expectedRevision !== "string" || !body.config || typeof body.config !== "object") {
      sendJson(response, 400, { code: "invalid_request", error: "expectedRevision and config are required" });
      return;
    }
    const document = await readGlobalSettingsDocument(config);
    if (document.revision !== body.expectedRevision) {
      sendJson(response, 409, {
        code: "revision_conflict",
        error: "config file changed on disk",
        expectedRevision: body.expectedRevision,
        actualRevision: document.revision
      });
      return;
    }
    const validation = validateGlobalConfigDraft(
      document,
      body.config as EditableGlobalConfigDraft,
      await readRegisteredProjectConfigs(config.homeRoot)
    );
    if (!validation.valid || !validation.candidate) {
      sendJson(response, 422, {
        code: "config_invalid",
        error: "Provider configuration is invalid",
        errors: validation.errors
      });
      return;
    }
    const providers = controlPlaneConfigSchema.parse({
      runner: { permissions: [] },
      actors: {},
      ...(validation.candidate.acp_providers
        ? { acp_providers: validation.candidate.acp_providers }
        : {})
    }).acpProviders ?? defaultAcpProviderInstances();
    const detectionResults = await detectAcpProviderInstances(providers);
    sendJson(response, 200, {
      detectedAt: new Date().toISOString(),
      results: detectionResults.map((result) => localizeAcpProviderDetection(result, config.language))
    });
    return;
  }

  if (url.pathname === "/api/settings/global" && request.method === "PUT") {
    if (!authorizeSettingsRequest(request, response, config, options, true)) return;
    const body = await readJsonBody<{ expectedRevision?: unknown; config?: unknown }>(request, 128 * 1024);
    if (typeof body.expectedRevision !== "string" || !body.config || typeof body.config !== "object") {
      sendJson(response, 400, { code: "invalid_request", error: "expectedRevision and config are required" });
      return;
    }
    const document = await readGlobalSettingsDocument(config);
    try {
      const saved = await writeGlobalConfigDraft({
        document,
        expectedRevision: body.expectedRevision,
        draft: body.config as EditableGlobalConfigDraft,
        projects: () => readRegisteredProjectConfigs(config.homeRoot)
      });
      config.language = resolveViewLocale(saved.raw.language);
      sendJson(response, 200, {
        ...globalSettingsPayload(
          saved,
          options.runningRevision ?? document.revision,
          config.view,
          await readRegisteredProjectConfigs(config.homeRoot)
        ),
        saved: true
      });
    } catch (error) {
      if (error instanceof ConfigDraftValidationError) {
        sendJson(response, 422, {
          code: "config_invalid",
          error: error.message,
          errors: error.errors
        });
        return;
      }
      if (error instanceof ConfigRevisionConflictError) {
        sendJson(response, 409, {
          code: "revision_conflict",
          error: error.message,
          expectedRevision: error.expectedRevision,
          actualRevision: error.actualRevision
        });
        return;
      }
      throw error;
    }
    return;
  }

  if (url.pathname === "/api/settings/project" && request.method === "GET") {
    if (!authorizeSettingsRequest(request, response, config, options)) return;
    const document = await readCurrentProjectSettingsDocument(config);
    if (!document) {
      sendJson(response, 404, { code: "project_unavailable", error: "No Project is currently selected" });
      return;
    }
    sendJson(response, 200, projectSettingsPayload(document));
    return;
  }

  if (url.pathname === "/api/settings/project/validate" && request.method === "POST") {
    if (!authorizeSettingsRequest(request, response, config, options, true)) return;
    const body = await readJsonBody<{ expectedRevision?: unknown; config?: unknown }>(request, 128 * 1024);
    if (typeof body.expectedRevision !== "string" || !body.config || typeof body.config !== "object") {
      sendJson(response, 400, { code: "invalid_request", error: "expectedRevision and config are required" });
      return;
    }
    const document = await readCurrentProjectSettingsDocument(config);
    if (!document) {
      sendJson(response, 404, { code: "project_unavailable", error: "No Project is currently selected" });
      return;
    }
    if (document.revision !== body.expectedRevision) {
      sendJson(response, 409, {
        code: "revision_conflict",
        error: "Project config file changed on disk",
        expectedRevision: body.expectedRevision,
        actualRevision: document.revision
      });
      return;
    }
    const global = await readGlobalSettingsDocument(config);
    const validation = validateProjectConfigDraft(
      document,
      body.config as EditableProjectConfigDraft,
      global.raw
    );
    const { candidate: _candidate, ...publicValidation } = validation;
    sendJson(response, validation.valid ? 200 : 422, {
      ...publicValidation,
      expectedRevision: document.revision,
      restartRequired: false
    });
    return;
  }

  if (url.pathname === "/api/settings/project" && request.method === "PUT") {
    if (!authorizeSettingsRequest(request, response, config, options, true)) return;
    const body = await readJsonBody<{ expectedRevision?: unknown; config?: unknown }>(request, 128 * 1024);
    if (typeof body.expectedRevision !== "string" || !body.config || typeof body.config !== "object") {
      sendJson(response, 400, { code: "invalid_request", error: "expectedRevision and config are required" });
      return;
    }
    const document = await readCurrentProjectSettingsDocument(config);
    if (!document) {
      sendJson(response, 404, { code: "project_unavailable", error: "No Project is currently selected" });
      return;
    }
    try {
      const global = await readGlobalSettingsDocument(config);
      const saved = await writeProjectConfigDraft({
        document,
        expectedRevision: body.expectedRevision,
        draft: body.config as EditableProjectConfigDraft,
        globalConfigPath: global.configPath
      });
      sendJson(response, 200, { ...projectSettingsPayload(saved), saved: true });
    } catch (error) {
      if (error instanceof ConfigDraftValidationError) {
        sendJson(response, 422, {
          code: "config_invalid",
          error: error.message,
          errors: error.errors
        });
        return;
      }
      if (error instanceof ConfigRevisionConflictError) {
        sendJson(response, 409, {
          code: "revision_conflict",
          error: error.message,
          expectedRevision: error.expectedRevision,
          actualRevision: error.actualRevision
        });
        return;
      }
      throw error;
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/memories") {
    const changeId = url.searchParams.get("change")?.trim();
    try {
      const payload = url.searchParams.get("representation") === "summary"
        ? await loadMemorySummaryPayload(config, viewCache, changeId || undefined)
        : await loadMemoryPayload(config, viewCache, changeId || undefined);
      sendJson(response, 200, payload);
    } catch (error) {
      const missing = Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
      sendJson(response, missing ? 404 : 400, {
        code: missing ? "changeset_not_found" : "changeset_unavailable",
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/market/memories") {
    try {
      if (url.searchParams.get("representation") === "count") {
        sendJson(response, 200, { count: await countMemoryMarket() });
        return;
      }
      const [memories, changeResult] = await Promise.all([
        listMemoryMarket(config.memoryRoot),
        config.project?.name
          ? listMemoryChangesBestEffort({
            home: config.homeRoot,
            project: config.project.name,
            memoryScope: "canonical"
          })
          : Promise.resolve({ changes: [], failures: [] })
      ]);
      const importing = activeMarketImports(changeResult.changes);
      sendJson(response, 200, {
        memories: memories.map((memory) => {
          const changeId = importing.get(memory.reference);
          return changeId ? { ...memory, status: "importing", changeId } : memory;
        })
      });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  const marketImportMatch = url.pathname.match(/^\/api\/market\/memories\/([^/]+)\/([^/]+)\/import$/);
  if (request.method === "POST" && marketImportMatch) {
    if (!config.project?.name) {
      sendJson(response, 404, { error: "No Project is currently selected" });
      return;
    }
    try {
      const kind = decodeURIComponent(marketImportMatch[1]) as MemoryKind;
      const name = decodeURIComponent(marketImportMatch[2]);
      if (!memoryKinds.includes(kind)) throw new Error(`invalid Memory kind: ${kind}`);
      const reference = `${kind}/${name}`;
      const body = await readJsonBody<{ operator?: unknown }>(request);
      const active = activeMarketImports((await listMemoryChangesBestEffort({
        home: config.homeRoot,
        project: config.project.name,
        memoryScope: "canonical"
      })).changes).get(reference);
      if (active) {
        const change = await readMemoryChange({
          home: config.homeRoot,
          project: config.project.name,
          memoryScope: "canonical",
          changeId: active
        });
        sendJson(response, 200, { change: await memoryChangeSummary(change) });
        return;
      }
      const plan = await planMemoryMarketImport(config.memoryRoot, reference);
      const change = await createMarketMemoryChange({
        home: config.homeRoot,
        project: config.project.name,
        actor: resolveMemoryChangeActor(config, body.operator),
        targets: plan.targets
      });
      sendJson(response, 201, { change: await memoryChangeSummary(change) });
    } catch (error) {
      if (error instanceof MarketMemoryNameConflictError) {
        sendJson(response, 409, { code: "market_name_conflict", error: error.message });
      } else {
        sendMemoryChangeError(response, error);
      }
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/changes") {
    if (!config.project?.name) {
      sendJson(response, 200, { changes: [] });
      return;
    }
    const { changes, failures } = await listMemoryChangesBestEffort({
      home: config.homeRoot,
      project: config.project.name,
      memoryScope: "canonical"
    });
    sendJson(response, 200, {
      changes: [
        ...await Promise.all(changes.map(memoryChangeSummary)),
        ...failures.map((failure) => ({
          id: failure.id,
          status: "unavailable",
          active: false,
          memoryPaths: [],
          error: failure.error
        }))
      ]
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/changes") {
    if (!config.project?.name) {
      sendJson(response, 404, { error: "No Project is currently selected" });
      return;
    }
    try {
      const body = await readJsonBody<{ memoryReference?: unknown; operator?: unknown }>(request);
      if (typeof body.memoryReference !== "string" || !body.memoryReference.trim()) {
        throw new Error("memoryReference is required");
      }
      const change = await createViewMemoryChange({
        home: config.homeRoot,
        project: config.project.name,
        reference: body.memoryReference.trim(),
        actor: resolveMemoryChangeActor(config, body.operator)
      });
      sendJson(response, 201, { change: await memoryChangeSummary(change) });
    } catch (error) {
      sendMemoryChangeError(response, error);
    }
    return;
  }

  const changeMatch = url.pathname.match(/^\/api\/changes\/([^/]+)$/);
  if (request.method === "GET" && changeMatch) {
    if (!config.project?.name) {
      sendJson(response, 404, { error: "No Project is currently selected" });
      return;
    }
    const changeId = decodeURIComponent(changeMatch[1]);
    let change: MemoryChangeSet;
    try {
      change = await readMemoryChange({
        home: config.homeRoot,
        project: config.project.name,
        memoryScope: "canonical",
        changeId
      });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        sendJson(response, 404, { code: "changeset_not_found", error: `ChangeSet not found: ${changeId}` });
        return;
      }
      throw error;
    }
    const source: MemoryPayload["source"] = {
        mode: "changeset",
        changeId: change.id,
        storeType: change.store_type,
        baseRevision: change.checkpoint?.base_revision,
        updatedAt: change.updated_at,
        valid: change.checkpoint?.valid,
        issues: change.checkpoint?.issues
    };
    const targetMemories = await withMemoryChangeDetailSnapshot({
      home: config.homeRoot,
      project: config.project.name,
      memoryScope: "canonical",
      changeId,
      use: async ({ files }) => Promise.all(files.map(async (file) => {
        const memory = file.candidatePath
          ? memoryPayloadFromSource(file.label, await readFile(file.candidatePath, "utf8"))
          : undefined;
        const baseMemory = file.basePath
          ? memoryPayloadFromSource(file.label, await readFile(file.basePath, "utf8"))
          : undefined;
        return {
          reference: file.reference,
          operation: file.operation,
          ...(memory ? { memory } : {}),
          ...(baseMemory ? { baseMemory } : {})
        };
      }))
    });
    sendJson(response, 200, {
      change: await memoryChangeSummary(change),
      targets: change.targets,
      targetMemories,
      comments: change.comments,
      actorNames: Object.fromEntries(
        Object.entries(config.controlPlane?.actors ?? {}).map(([actorId, actor]) => [actorId, actor.name])
      ),
      actorKinds: Object.fromEntries(
        Object.entries(config.controlPlane?.actors ?? {}).map(([actorId, actor]) => [actorId, actor.kind])
      ),
      source
    });
    return;
  }

  const changeMemoriesMatch = url.pathname.match(/^\/api\/changes\/([^/]+)\/memories$/);
  if (request.method === "POST" && changeMemoriesMatch) {
    if (!config.project?.name) {
      sendJson(response, 404, { error: "No Project is currently selected" });
      return;
    }
    try {
      const body = await readJsonBody<{ memoryReference?: unknown; expectedUpdatedAt?: unknown }>(request);
      if (typeof body.memoryReference !== "string" || !body.memoryReference.trim()) {
        throw new Error("memoryReference is required");
      }
      const change = await addMemoryChangeScope({
        home: config.homeRoot,
        project: config.project.name,
        changeId: decodeURIComponent(changeMemoriesMatch[1]),
        reference: body.memoryReference.trim(),
        expectedUpdatedAt: typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined
      });
      sendJson(response, 200, { change: await memoryChangeSummary(change) });
    } catch (error) {
      sendMemoryChangeError(response, error);
    }
    return;
  }

  const changeAbandonMatch = url.pathname.match(/^\/api\/changes\/([^/]+)\/abandon$/);
  if (request.method === "POST" && changeAbandonMatch) {
    if (!config.project?.name) {
      sendJson(response, 404, { error: "No Project is currently selected" });
      return;
    }
    try {
      const body = await readJsonBody<{ expectedUpdatedAt?: unknown }>(request);
      const change = await abandonMemoryChange({
        home: config.homeRoot,
        project: config.project.name,
        changeId: decodeURIComponent(changeAbandonMatch[1]),
        expectedUpdatedAt: typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined
      });
      sendJson(response, 200, { change: await memoryChangeSummary(change) });
    } catch (error) {
      sendMemoryChangeError(response, error);
    }
    return;
  }

  const changeCommentsMatch = url.pathname.match(/^\/api\/changes\/([^/]+)\/comments$/);
  if (request.method === "POST" && changeCommentsMatch) {
    if (!config.project?.name) {
      sendJson(response, 404, { error: "No Project is currently selected" });
      return;
    }
    try {
      const body = await readJsonBody<{
        operator?: unknown;
        memoryReference?: unknown;
        path?: unknown;
        target?: unknown;
        location?: unknown;
        snapshot?: unknown;
        body?: unknown;
        expectedUpdatedAt?: unknown;
      }>(request);
      if (typeof body.memoryReference !== "string" || typeof body.path !== "string" || typeof body.body !== "string") {
        throw new Error("memoryReference, path, and body are required");
      }
      const result = await createMemoryChangeComment({
        home: config.homeRoot,
        project: config.project.name,
        changeId: decodeURIComponent(changeCommentsMatch[1]),
        actor: resolveMemoryChangeActor(config, body.operator),
        memoryReference: body.memoryReference,
        path: body.path,
        target: typeof body.target === "string" ? body.target : undefined,
        location: normalizeMemoryChangeLocation(body.location),
        snapshot: typeof body.snapshot === "string" ? body.snapshot : undefined,
        body: body.body,
        expectedUpdatedAt: typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined
      });
      sendJson(response, 201, { change: await memoryChangeSummary(result.change), comment: result.comment });
    } catch (error) {
      sendMemoryChangeError(response, error);
    }
    return;
  }

  const changeCommentMatch = url.pathname.match(/^\/api\/changes\/([^/]+)\/comments\/([^/]+)$/);
  if (["PATCH", "DELETE"].includes(request.method ?? "") && changeCommentMatch) {
    if (!config.project?.name) {
      sendJson(response, 404, { error: "No Project is currently selected" });
      return;
    }
    try {
      const body = await readJsonBody<{
        operator?: unknown;
        body?: unknown;
        withdraw?: unknown;
        expectedUpdatedAt?: unknown;
      }>(request);
      const common = {
        home: config.homeRoot,
        project: config.project.name,
        changeId: decodeURIComponent(changeCommentMatch[1]),
        commentId: decodeURIComponent(changeCommentMatch[2]),
        actor: resolveMemoryChangeActor(config, body.operator),
        expectedUpdatedAt: typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined
      };
      if (request.method === "DELETE") {
        const change = await deleteMemoryChangeComment(common);
        sendJson(response, 200, { change: await memoryChangeSummary(change) });
      } else {
        const result = await updateMemoryChangeComment({
          ...common,
          body: typeof body.body === "string" ? body.body : undefined,
          withdraw: body.withdraw === true
        });
        sendJson(response, 200, { change: await memoryChangeSummary(result.change), comment: result.comment });
      }
    } catch (error) {
      sendMemoryChangeError(response, error);
    }
    return;
  }

  const memoryMatch = url.pathname.match(/^\/api\/memories\/([^/]+)\/([^/]+)$/);
  if (request.method === "GET" && memoryMatch) {
    const kind = decodeURIComponent(memoryMatch[1]) as MemoryKind;
    const name = decodeURIComponent(memoryMatch[2]);
    if (!memoryKinds.includes(kind)) {
      sendJson(response, 404, { error: "memory not found" });
      return;
    }
    const changeId = url.searchParams.get("change")?.trim();
    try {
      const memory = await loadMemoryDetailPayload(
        config,
        viewCache,
        kind,
        name,
        changeId || undefined,
        url.searchParams.get("effective") === "true"
      );
      if (!memory) {
        sendJson(response, 404, { error: "memory not found" });
        return;
      }
      sendJson(response, 200, { memory });
    } catch (error) {
      const missing = Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
      sendJson(response, missing ? 404 : 400, {
        code: missing ? "changeset_not_found" : "changeset_unavailable",
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/runs") {
    if (url.searchParams.get("representation") === "summary") {
      const status = url.searchParams.get("status")?.trim();
      if (status && !["running", "done", "abandoned"].includes(status)) {
        sendJson(response, 400, { error: "unsupported Run status" });
        return;
      }
      const runs = await listRunSummaries(config.runsRoot);
      sendJson(response, 200, { runs: status ? runs.filter(run => run.status === status) : runs });
      return;
    }
    sendJson(response, 200, { runs: await loadRunPayload(config) });
    return;
  }

  const runAbandonMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/abandon$/);
  if (request.method === "POST" && runAbandonMatch) {
    try {
      const body = await readJsonBody<{ reason?: unknown; actorId?: unknown }>(request);
      if (body.reason !== undefined && typeof body.reason !== "string") {
        throw new Error("reason must be a string");
      }
      if (body.actorId !== undefined && typeof body.actorId !== "string") {
        throw new Error("actorId must be a string");
      }
      const result = await abandonRun({
        runsRoot,
        runId: decodeURIComponent(runAbandonMatch[1]),
        source: "view",
        reason: body.reason,
        actorId: body.actorId
      });
      sendJson(response, 200, {
        run: await toViewRunPayload(runsRoot, result.run),
        warnings: result.terminationWarnings
      });
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  const runBindingsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/bindings$/);
  if (runBindingsMatch) {
    const runId = decodeURIComponent(runBindingsMatch[1]);
    try {
      if (request.method === "GET") {
        sendJson(response, 200, buildRunBindingSnapshot(await readRun(runsRoot, runId)));
        return;
      }
      if (request.method === "POST") {
        const rejection = jsonMutationOriginRejection(request, config, "Run binding");
        if (rejection) {
          sendJson(response, 403, { code: "request_origin_rejected", error: rejection });
          return;
        }
        const body = await readJsonBody<{ slot?: unknown; actorIds?: unknown; skip?: unknown }>(request);
        const slot = typeof body.slot === "string" ? body.slot : "";
        const actorIds = Array.isArray(body.actorIds) && body.actorIds.every((actor) => typeof actor === "string")
          ? body.actorIds as string[]
          : undefined;
        const skip = body.skip === true;
        const result = await updateRunSlotBinding({ runsRoot, runId, slot, actorIds, skip });
        sendJson(response, 200, { change: result.change, bindings: result.snapshot });
        return;
      }
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
      return;
    }
  }

  const artifactReviewRoundMatch = url.pathname.match(/^\/api\/artifact-reviews\/([^/]+)\/rounds\/([^/]+)$/);
  if (request.method === "GET" && artifactReviewRoundMatch) {
    const actorId = url.searchParams.get("actor_id")?.trim();
    try {
      const reviewId = decodeURIComponent(artifactReviewRoundMatch[1]);
      const roundId = decodeURIComponent(artifactReviewRoundMatch[2]);
      if (actorId) {
        const context = await readArtifactReviewForActor({
          runsRoot,
          reviewId,
          roundId,
          actorId
        });
        if ((context.assignment.actorKind ?? "human") !== "human") {
          throw new Error(`Agent Artifact Review assignment is not assigned to the Human View API: ${actorId}`);
        }
        sendJson(response, 200, await artifactReviewContextPayload(runsRoot, context));
      } else {
        const located = await findViewArtifactReview(config, reviewId);
        const round = located.review.rounds.find((candidate) => candidate.id === roundId);
        if (!round) throw new Error(`Artifact Review Round not found: ${roundId}`);
        sendJson(response, 200, await artifactReviewContextPayload(located.runsRoot, {
          run: located.run,
          review: located.review,
          round
        }));
      }
    } catch (error) {
      sendArtifactReviewError(response, error);
    }
    return;
  }

  const directArtifactReviewRoundMatch = url.pathname.match(
    /^\/api\/runs\/([^/]+)\/artifact-reviews\/([^/]+)\/rounds\/([^/]+)$/
  );
  if (request.method === "GET" && directArtifactReviewRoundMatch) {
    const actorId = url.searchParams.get("actor_id")?.trim();
    try {
      const runId = decodeURIComponent(directArtifactReviewRoundMatch[1]);
      const reviewId = decodeURIComponent(directArtifactReviewRoundMatch[2]);
      const roundId = decodeURIComponent(directArtifactReviewRoundMatch[3]);
      const located = await readViewRunById(config, runId);
      const review = located.run.artifactReviews?.find((candidate) => candidate.id === reviewId);
      if (!review) throw new Error(`Artifact Review not found: ${reviewId}`);
      const round = review.rounds.find((candidate) => candidate.id === roundId);
      if (!round) throw new Error(`Artifact Review Round not found: ${roundId}`);
      if (actorId) {
        const context = artifactReviewForActor({ run: located.run, review, roundId, actorId });
        if ((context.assignment.actorKind ?? "human") !== "human") {
          throw new Error(`Agent Artifact Review assignment is not assigned to the Human View API: ${actorId}`);
        }
        sendJson(response, 200, await artifactReviewContextPayload(located.runsRoot, context));
      } else {
        sendJson(response, 200, await artifactReviewContextPayload(located.runsRoot, {
          run: located.run,
          review,
          round
        }));
      }
    } catch (error) {
      sendArtifactReviewError(response, error);
    }
    return;
  }

  const artifactReviewActivityMatch = url.pathname.match(
    /^\/api\/artifact-reviews\/([^/]+)\/rounds\/([^/]+)\/assignments\/([^/]+)\/attempts\/(\d+)\/activity$/
  );
  if (request.method === "GET" && artifactReviewActivityMatch) {
    try {
      const reviewId = decodeURIComponent(artifactReviewActivityMatch[1]);
      const roundId = decodeURIComponent(artifactReviewActivityMatch[2]);
      const actorId = decodeURIComponent(artifactReviewActivityMatch[3]);
      const sequence = Number(artifactReviewActivityMatch[4]);
      const cursor = normalizeActivityInteger(url.searchParams.get("cursor"), 0, "cursor");
      const limit = normalizeActivityInteger(url.searchParams.get("limit"), 500, "limit");
      const located = await findViewArtifactReview(config, reviewId);
      const round = located.review.rounds.find((candidate) => candidate.id === roundId);
      if (!round) throw new Error(`Artifact Review Round not found: ${roundId}`);
      const assignment = round.assignments.find((candidate) => candidate.actorId === actorId);
      if (!assignment) throw new Error(`Actor is not assigned to Artifact Review Round: ${actorId}`);
      if ((assignment.actorKind ?? "human") !== "agent") {
        throw new Error(`Artifact Review Activity is read-only for Agent assignments: ${actorId}`);
      }
      const attempt = assignment.attempts?.find((candidate) => candidate.sequence === sequence);
      if (!attempt) throw new Error(`Agent Review attempt not found: ${sequence}`);
      const snapshot = await readAgentActivitySnapshot({
        runsRoot: located.runsRoot,
        runId: located.run.id,
        reviewId,
        roundId,
        assignmentId: artifactReviewAssignmentId(assignment),
        attemptId: attempt.id,
        workspaceRoot: dirname(config.scopeRoot)
      });
      sendJson(response, 200, agentActivityDelta(snapshot, cursor, limit));
    } catch (error) {
      sendArtifactReviewError(response, error);
    }
    return;
  }

  const artifactReviewAssignmentMatch = url.pathname.match(
    /^\/api\/artifact-reviews\/([^/]+)\/rounds\/([^/]+)\/assignments\/([^/]+)\/(draft|submit)$/
  );
  if (artifactReviewAssignmentMatch && ["PATCH", "POST"].includes(request.method ?? "")) {
    const reviewId = decodeURIComponent(artifactReviewAssignmentMatch[1]);
    const roundId = decodeURIComponent(artifactReviewAssignmentMatch[2]);
    const actorId = decodeURIComponent(artifactReviewAssignmentMatch[3]);
    const operation = artifactReviewAssignmentMatch[4];
    try {
      const body = await readJsonBody<{
        expectedRevision?: unknown;
        vote?: unknown;
        comments?: unknown;
      }>(request);
      const expectedRevision = normalizeExpectedRevision(body.expectedRevision);
      const context = operation === "draft"
        ? await updateArtifactReviewDraft({
            runsRoot,
            reviewId,
            roundId,
            actorId,
            expectedRevision,
            draft: normalizeArtifactReviewDraft(body)
          })
        : await submitArtifactReviewAssignment({
            runsRoot,
            reviewId,
            roundId,
            actorId,
            expectedRevision
          });
      sendJson(response, 200, await artifactReviewContextPayload(runsRoot, context));
    } catch (error) {
      sendArtifactReviewError(response, error);
    }
    return;
  }

  const artifactReviewRetryMatch = url.pathname.match(
    /^\/api\/artifact-reviews\/([^/]+)\/rounds\/([^/]+)\/assignments\/([^/]+)\/retry$/
  );
  if (request.method === "POST" && artifactReviewRetryMatch) {
    try {
      const context = await retryArtifactReviewAgentAssignment({
        runsRoot,
        reviewId: decodeURIComponent(artifactReviewRetryMatch[1]),
        roundId: decodeURIComponent(artifactReviewRetryMatch[2]),
        actorId: decodeURIComponent(artifactReviewRetryMatch[3])
      });
      await dispatchArtifactReviewAgents({ config, run: context.run });
      sendJson(response, 200, await artifactReviewContextPayload(runsRoot, context));
    } catch (error) {
      sendArtifactReviewError(response, error);
    }
    return;
  }

  const artifactReviewResolveMatch = url.pathname.match(
    /^\/api\/artifact-reviews\/([^/]+)\/rounds\/([^/]+)\/comments\/([^/]+)\/resolve$/
  );
  if (request.method === "POST" && artifactReviewResolveMatch) {
    try {
      const body = await readJsonBody<{
        disposition?: unknown;
        note?: unknown;
        validationSummary?: unknown;
      }>(request);
      const dispositions = ["accepted-fixed", "accepted-followup", "rejected-out-of-scope", "rejected-not-blocking", "rejected-invalid"] as const;
      if (!dispositions.includes(body.disposition as typeof dispositions[number])) {
        throw new Error("invalid Artifact Review Comment disposition");
      }
      const context = await resolveArtifactReviewComment({
        runsRoot,
        reviewId: decodeURIComponent(artifactReviewResolveMatch[1]),
        roundId: decodeURIComponent(artifactReviewResolveMatch[2]),
        commentId: decodeURIComponent(artifactReviewResolveMatch[3]),
        disposition: body.disposition as typeof dispositions[number],
        note: typeof body.note === "string" ? body.note : undefined,
        validationSummary: typeof body.validationSummary === "string" ? body.validationSummary : undefined
      });
      sendJson(response, 200, { review: artifactReviewSummary(context.review, context.run.controlPlane) });
    } catch (error) {
      sendArtifactReviewError(response, error);
    }
    return;
  }

  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
  if (request.method === "GET" && runMatch) {
    const runId = decodeURIComponent(runMatch[1]);
    let located: Awaited<ReturnType<typeof readViewRunById>>;
    try {
      located = await readViewRunById(config, runId);
    } catch (error) {
      if (error instanceof Error && error.message === `Run not found: ${runId}`) {
        sendJson(response, 404, { error: "run not found" });
        return;
      }
      throw error;
    }
    if (located.runsRoot === runsRoot) await dispatchArtifactReviewAgents({ config, run: located.run });
    const run = located.runsRoot === runsRoot
      ? await ensureCurrentSchemaDraft(
        located.runsRoot,
        await readRun(located.runsRoot, located.run.id)
      )
      : { ...located.run, readOnly: true as const };
    sendJson(response, 200, {
      run: await toViewRunPayload(located.runsRoot, run)
    });
    return;
  }


  const archiveRunMatch = url.pathname.match(/^\/api\/archive\/runs\/([^/]+)$/);
  if (request.method === "POST" && archiveRunMatch) {
    const entry = await archiveRun({
      archiveRoot,
      runsRoot,
      id: decodeURIComponent(archiveRunMatch[1])
    });
    sendJson(response, 200, { archived: entry });
    return;
  }

  const archiveChangeMatch = url.pathname.match(/^\/api\/archive\/changes\/([^/]+)$/);
  if (request.method === "POST" && archiveChangeMatch) {
    if (!config.project?.name) {
      sendJson(response, 404, { error: "No Project is currently selected" });
      return;
    }
    try {
      const body = await readJsonBody<{ expectedUpdatedAt?: unknown }>(request);
      const entry = await archiveMemoryChange({
        home: config.homeRoot,
        project: config.project.name,
        changeId: decodeURIComponent(archiveChangeMatch[1]),
        expectedUpdatedAt: typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined
      });
      sendJson(response, 200, { archived: entry });
    } catch (error) {
      sendMemoryChangeError(response, error);
    }
    return;
  }

  if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method ?? "")) {
    sendText(response, 405, "Method Not Allowed");
    return;
  }

  sendText(response, 404, "Not Found");
}

async function readViewStartupConfig(): Promise<MemsphereConfig> {
  try {
    return await readViewConfig();
  } catch (error) {
    const first = (await listRegisteredProjects(resolveMemsphereHome())).find((project) => !project.missing);
    if (!first) throw error;
    return readProjectConfig(first.name);
  }
}

async function readViewServiceConfig(): Promise<MemsphereConfig> {
  try {
    return await readViewStartupConfig();
  } catch {
    const home = resolveMemsphereHome();
    return {
      configPath: join(home, "config.json"),
      scopeRoot: home,
      homeRoot: home,
      language: "zh-CN",
      memoryRoot: join(home, "projects"),
      runsRoot: join(home, "projects"),
      archiveRoot: join(home, "projects"),
      debug: { agentReview: false, root: join(home, ".runtime", "debug") },
      view: { host: "127.0.0.1", port: 0 }
    };
  }
}

function memoryPayloadFromSource(label: string, content: string): {
  id: string;
  kind: string;
  path: string;
  entity?: unknown;
  error?: string;
} {
  try {
    const entity = parseMemoryYaml(content);
    const kind = memoryKindFromSnapshot(label, entity);
    const primaryName = entity && typeof entity === "object" && Array.isArray((entity as { names?: unknown }).names)
      ? ((entity as { names: string[] }).names[0] ?? label)
      : label;
    return { id: `${kind}/${primaryName}`, kind, path: label, entity };
  } catch (error) {
    const kind = memoryKindFromSnapshot(label, undefined);
    const fileName = label.split(/[\\/]/).at(-1) ?? label;
    const name = fileName.replace(/\.ya?ml$/i, "") || "invalid";
    return {
      id: `${kind}/${name}`,
      kind,
      path: label,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function memoryKindFromSnapshot(label: string, entity: unknown): string {
  const fromLabel = label.split(/[\\/]/)[0];
  if (["procedures", "schemas", "concepts", "statements"].includes(fromLabel)) return fromLabel;
  const tag = entity && typeof entity === "object" ? (entity as { tag?: unknown }).tag : undefined;
  if (tag === "!procedure") return "procedures";
  if (tag === "!schema") return "schemas";
  if (tag === "!concept") return "concepts";
  if (tag === "!statement") return "statements";
  return "memories";
}


async function buildMemoryFileIndex(memoryRoot: string): Promise<Map<string, { kind: MemoryKind; path: string }>> {
  const result = new Map<string, { kind: MemoryKind; path: string }>();
  for (const kind of memoryKinds) {
    const paths = await listMemoryFiles(memoryRoot, kind);
    for (const path of paths) {
      try {
        const file = await readMemoryFileSummary(kind, path);
        const primaryName = file.names[0];
        result.set(`${file.kind}/${primaryName}`, { kind: file.kind, path: file.path });
      } catch {
        // Invalid memories should not block creating a review for another file.
      }
    }
  }
  return result;
}

async function loadMemoryPayload(config: MemsphereConfig, viewCache: ViewMemoryCache, changeId?: string): Promise<MemoryPayload> {
  return withMemoryPayloadRoot(config, viewCache, changeId, (memoryRoot, source) =>
    loadMemoryPayloadFromRoot(config, viewCache, memoryRoot, source)
  );
}


async function memoryChangeSummary(change: MemoryChangeSet): Promise<unknown> {
  const counts = { create: 0, update: 0, delete: 0, rename: 0 };
  for (const target of change.targets) counts[target.operation] += 1;
  const commentCounts = { pending: 0, processing: 0, completed: 0 };
  for (const comment of change.comments) commentCounts[comment.status] += 1;
  return {
    id: change.id,
    project: change.project,
    storeType: change.store_type,
    status: change.status,
    origin: change.origin,
    intent: change.intent,
    active: change.status === "active",
    baseRevision: change.base_revision,
    createdAt: change.created_at,
    updatedAt: change.updated_at,
    publishedRevision: change.published_revision,
    candidateRevision: change.candidate_revision,
    digest: change.checkpoint?.digest,
    validatedAt: change.checkpoint?.created_at,
    valid: change.checkpoint?.valid,
    issues: change.checkpoint?.issues ?? [],
    counts,
    targetCount: change.targets.length,
    scopeCount: change.scope.length,
    memoryPaths: [...new Set([
      ...change.scope.map((item) => item.path),
      ...change.targets.map((item) => item.destination_path ?? item.path)
    ])],
    commentCounts,
    createdBy: change.created_by,
    claimed: Boolean(change.claim),
    sourceWorktree: change.source_worktree ? {
      root: change.source_worktree.root,
      repositoryRoot: change.source_worktree.repository_root,
      memoryPath: change.source_worktree.memory_path,
      available: await pathAvailable(change.source_worktree.root)
    } : undefined
  };
}

async function pathAvailable(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function activeMarketImports(changes: readonly MemoryChangeSet[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const change of changes) {
    if (change.status !== "active" || change.intent !== "market_import") continue;
    for (const target of change.targets) {
      if (!result.has(target.reference)) result.set(target.reference, change.id);
    }
  }
  return result;
}

function resolveMemoryChangeActor(config: MemsphereConfig, input: unknown): MemoryChangeActor {
  if (!input || typeof input !== "object") throw new Error("operator is required");
  const operator = input as { kind?: unknown; id?: unknown };
  if (operator.kind === "human" && typeof operator.id === "string") {
    const actor = config.controlPlane?.actors?.[operator.id];
    if (!actor || actor.kind !== "human") throw new Error(`Human Actor not found: ${operator.id}`);
    return { kind: "human", id: operator.id, name: actor.name };
  }
  if (operator.kind === "browser" && typeof operator.id === "string") {
    return { kind: "browser", id: operator.id, name: "Browser user" };
  }
  throw new Error("operator must identify a configured Human Actor or a browser UUID");
}

function normalizeMemoryChangeLocation(input: unknown): { anchor: string; line?: number; hash?: string } | undefined {
  if (input === undefined) return undefined;
  if (!input || typeof input !== "object") throw new Error("location must be an object");
  const location = input as { anchor?: unknown; line?: unknown; hash?: unknown };
  if (typeof location.anchor !== "string" || !location.anchor.trim()) throw new Error("location.anchor is required");
  if (location.line !== undefined && (!Number.isInteger(location.line) || Number(location.line) < 1)) {
    throw new Error("location.line must be a positive integer");
  }
  if (location.hash !== undefined && typeof location.hash !== "string") throw new Error("location.hash must be a string");
  return {
    anchor: location.anchor.trim(),
    ...(location.line !== undefined ? { line: Number(location.line) } : {}),
    ...(typeof location.hash === "string" && location.hash ? { hash: location.hash } : {})
  };
}

function sendMemoryChangeError(response: ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof MemoryChangeIntegrityError) {
    sendJson(response, 500, { code: error.code, error: message });
    return;
  }
  const missing = /not found/i.test(message);
  const conflict = /changed since|already |only |claimed|not part of|belongs to/i.test(message);
  sendJson(response, missing ? 404 : conflict ? 409 : 400, {
    code: missing ? "changeset_not_found" : conflict ? "changeset_conflict" : "invalid_changeset_request",
    error: message
  });
}

async function withMemoryPayloadRoot<T>(
  config: MemsphereConfig,
  viewCache: ViewMemoryCache,
  changeId: string | undefined,
  use: (memoryRoot: string, source: MemoryPayload["source"]) => Promise<T>
): Promise<T> {
  if (changeId) {
    if (!config.project?.name) throw new Error("No Project is currently selected");
    return viewCache.previews.use({
      home: config.homeRoot,
      project: config.project.name,
      memoryScope: "canonical",
      changeId,
      use: async ({ change, memoryRoot }) => use(memoryRoot, {
        mode: "changeset",
        changeId: change.id,
        storeType: change.store_type,
        baseRevision: change.checkpoint?.base_revision,
        updatedAt: change.updated_at,
        valid: change.checkpoint?.valid,
        issues: change.checkpoint?.issues
      })
    });
  }
  return use(config.memoryRoot, { mode: "formal" });
}

async function loadMemoryPayloadFromRoot(
  config: MemsphereConfig,
  viewCache: ViewMemoryCache,
  memoryRoot: string,
  source: MemoryPayload["source"]
): Promise<MemoryPayload> {
  const memories: MemoryPayload["memories"] = [];
  const fileIndex = new Map<string, { kind: MemoryKind; path: string }>();
  const systemReferences = await systemMemoryReferences();
  const actorNames = Object.fromEntries(
    Object.entries(config.controlPlane?.actors ?? {}).map(([actorId, actor]) => [actorId, actor.name])
  );

  for (const kind of memoryKinds) {
    const paths = await listMemoryFiles(memoryRoot, kind);
    for (const path of paths) {
      const memory = await loadMemoryListItem(memoryRoot, kind, path, systemReferences);
      memories.push(memory);
      if (!memory.error) fileIndex.set(memory.id, { kind, path });
    }
  }

  viewCache.replaceIndex(memoryRoot, fileIndex);
  return {
    memoryRoot: config.memoryRoot,
    actorNames,
    actorKinds: Object.fromEntries(
      Object.entries(config.controlPlane?.actors ?? {}).map(([actorId, actor]) => [actorId, actor.kind])
    ),
    memories,
    source
  };
}

async function loadMemorySummaryPayload(config: MemsphereConfig, viewCache: ViewMemoryCache, changeId?: string): Promise<MemoryPayload> {
  return withMemoryPayloadRoot(config, viewCache, changeId, (memoryRoot, source) =>
    loadMemorySummaryPayloadFromRoot(config, viewCache, memoryRoot, source)
  );
}

async function loadMemorySummaryPayloadFromRoot(
  config: MemsphereConfig,
  viewCache: ViewMemoryCache,
  memoryRoot: string,
  source: MemoryPayload["source"]
): Promise<MemoryPayload> {
  const [systemReferences, pathsByKind] = await Promise.all([
    systemMemoryReferences(),
    Promise.all(memoryKinds.map(async kind => ({ kind, paths: await listMemoryFiles(memoryRoot, kind) })))
  ]);
  const memories: MemoryPayload["memories"] = [];
  const fileIndex = new Map<string, { kind: MemoryKind; path: string }>();
  const summaries = await Promise.all(pathsByKind.flatMap(({ kind, paths }) => paths.map(async path => {
    const relativePath = portableRelative(memoryRoot, path);
    try {
      return { ok: true as const, kind, path, relativePath, summary: await readMemoryFileSummary(kind, path) };
    } catch (error) {
      return { ok: false as const, kind, path, relativePath, error };
    }
  })));
  for (const item of summaries) {
    const { kind, path, relativePath } = item;
    if (item.ok) {
      const summary = item.summary;
      memories.push({
        id: `${kind}/${summary.names[0]}`,
        kind,
        path: relativePath,
        system: summary.names.some((name) => systemReferences.has(`${kind}/${name}`)),
        names: summary.names
      });
      fileIndex.set(`${kind}/${summary.names[0]}`, { kind, path });
    } else {
      memories.push({
        id: `${kind}/${relativePath}`,
        kind,
        path: relativePath,
        system: false,
        error: formatMemoryLoadError(item.error)
      });
    }
  }
  viewCache.replaceIndex(memoryRoot, fileIndex);
  return {
    memoryRoot: config.memoryRoot,
    actorNames: Object.fromEntries(
      Object.entries(config.controlPlane?.actors ?? {}).map(([actorId, actor]) => [actorId, actor.name])
    ),
    actorKinds: Object.fromEntries(
      Object.entries(config.controlPlane?.actors ?? {}).map(([actorId, actor]) => [actorId, actor.kind])
    ),
    memories,
    source
  };
}

async function loadMemoryDetailPayload(
  config: MemsphereConfig,
  viewCache: ViewMemoryCache,
  kind: MemoryKind,
  name: string,
  changeId?: string,
  effective = false
): Promise<MemoryPayload["memories"][number] | undefined> {
  return withMemoryPayloadRoot(config, viewCache, changeId, async (memoryRoot) => {
    const file = await viewCache.find(memoryRoot, `${kind}/${name}`);
    if (!file) return undefined;
    const memory = await loadMemoryListItem(memoryRoot, kind, file.path, await systemMemoryReferences());
    if (effective && memory.entity) await attachEffectiveRuleTrees(memoryRoot, memory.entity);
    return memory;
  });
}

async function attachEffectiveRuleTrees(memoryRoot: string, entity: unknown): Promise<void> {
  const statements = new Map<string, Awaited<ReturnType<typeof readMemoryFile>>["entity"]>();
  const lookup: RuleLookup = async (target) => {
    if (!statements.size) {
      for (const path of await listMemoryFiles(memoryRoot, "statements")) {
        const statement = await readMemoryFile("statements", path);
        const canonicalName = statement.entity.names[0];
        if (canonicalName) statements.set(`statements/${canonicalName}`, statement.entity);
      }
    }
    const statement = statements.get(target);
    if (!statement || statement.tag !== "!statement") throw new Error(`Statement not found: ${target}`);
    return statement;
  };

  const visit = async (value: unknown): Promise<void> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const node = value as Record<string, unknown>;
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) {
        for (const item of child) await visit(item);
      } else {
        await visit(child);
      }
    }
    const effectiveRules: Record<string, unknown> = {};
    for (const channel of ["asserts", "suggests"] as const) {
      const parts = node[channel];
      if (!Array.isArray(parts) || !parts.some(isMemoryReferenceValue)) continue;
      Object.assign(effectiveRules, toEffectiveRuleDisplayTree(await resolveRuleParts(channel, parts, lookup)));
    }
    if (Object.keys(effectiveRules).length) node.effectiveRules = effectiveRules;
  };
  await visit(entity);
}

function isMemoryReferenceValue(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { tag?: unknown }).tag === "!ref");
}

let systemMemoryReferencesPromise: Promise<Set<string>> | undefined;

async function systemMemoryReferences(): Promise<Set<string>> {
  systemMemoryReferencesPromise ??= readBundledSystemMemories().then(memories => new Set(
    memories.flatMap((memory) => memory.names.map((name) => `${memory.kind}/${name}`))
  ));
  return systemMemoryReferencesPromise;
}

async function loadRunPayload(config: MemsphereConfig): Promise<unknown[]> {
  const runs = await listRuns(config.runsRoot);
  await Promise.all(runs.map((run) => dispatchArtifactReviewAgents({ config, run })));
  const refreshed = await listRuns(config.runsRoot);
  const restored = await Promise.all(
    refreshed.map((run) => ensureCurrentSchemaDraft(config.runsRoot, run))
  );
  return Promise.all(restored.map((run) => toViewRunPayload(config.runsRoot, run)));
}

async function toViewRunPayload(runsRoot: string, run: RunState): Promise<unknown> {
  const hydrated = await hydrateRunArtifactContent(runsRoot, run);
  const { artifactReviews: _privateArtifactReviews, ...publicRun } = hydrated;
  const review = currentArtifactReview(hydrated);
  const schemaWriting = await schemaWritingPayload(runsRoot, hydrated);
  return toEffectiveRuleDisplayValue({
    ...publicRun,
    bindingSnapshot: buildRunBindingSnapshot(hydrated),
    artifactReview: review ? artifactReviewSummary(review, hydrated.controlPlane) : undefined,
    artifactReviewSummaries: (hydrated.artifactReviews ?? []).map((candidate) =>
      artifactReviewSummary(candidate, hydrated.controlPlane)
    ),
    schemaWriting
  });
}

async function schemaWritingPayload(runsRoot: string, run: RunState): Promise<unknown> {
  const snapshot = buildSchemaWritingSnapshot(runsRoot, run);
  if (!snapshot) return snapshot;
  const publicSnapshot = { ...snapshot, readOnly: run.status !== "running" };
  if (!snapshot.draft) return publicSnapshot;
  try {
    const content = await readFile(snapshot.draft.filePath, "utf8");
    return {
      ...publicSnapshot,
      draft: {
        ...snapshot.draft,
        content,
        renderedContent: renderMarkdownContent(content)
      }
    };
  } catch (error) {
    return {
      ...publicSnapshot,
      draft: {
        ...snapshot.draft,
        contentError: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

function artifactReviewSummary(
  review: NonNullable<RunState["artifactReviews"]>[number],
  controlPlane: RunState["controlPlane"]
): unknown {
  const round = review.rounds.find((candidate) => candidate.id === review.currentRoundId);
  const runnerVote = round?.votes.find((vote) => vote.subject.kind === "runner");
  const submission = review.submissions.find((candidate) => candidate.id === round?.submissionId);
  const advisoryComments = (round?.assignments ?? [])
    .filter((assignment) => assignment.binding === "advisory")
    .flatMap((assignment) => assignment.submitted?.comments ?? []);
  const resolvedCommentIds = new Set((round?.commentDispositions ?? []).map((item) => item.commentId));
  const severity = {
    blocking: advisoryComments.filter((comment) => comment.severity === "blocking").length,
    risk: advisoryComments.filter((comment) => comment.severity === "risk").length,
    suggestion: advisoryComments.filter((comment) => comment.severity === "suggestion").length,
    unspecified: advisoryComments.filter((comment) => !comment.severity).length
  };
  const failures = (round?.assignments ?? []).flatMap((assignment) => assignment.attempts ?? [])
    .filter((attempt) => attempt.status === "failed" && attempt.failure)
    .map((attempt) => ({ attempt: attempt.sequence, ...attempt.failure!, category: artifactReviewFailureCategory(attempt.failure!) }));
  const runnerCanDecide = authorizeArtifactOperation({
    controlPlane: round ? artifactReviewRoundControlPlane(review, round) : review.controlPlane,
    subject: { kind: "runner" },
    permission: "decision.decide"
  }).allowed;
  return {
    id: review.id,
    stepId: review.stepId,
    artifactName: review.artifactName,
    policyId: review.policyId,
    status: review.status,
    currentRoundId: review.currentRoundId,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    roundCount: review.rounds.length,
    outcome: review.outcome ? {
      status: review.outcome.status,
      submissionId: review.outcome.submissionId,
      roundId: review.outcome.roundId,
      completedAt: review.outcome.completedAt
    } : undefined,
    round: round ? {
      id: round.id,
      sequence: round.sequence,
      revision: round.revision,
      status: round.status,
      submitted: round.assignments.filter((assignment) => assignment.status === "submitted").length,
      total: round.assignments.length,
      decisionReady: round.assignments.every((assignment) => assignment.status === "submitted"),
      bindingSource: round.bindingSource,
      severity,
      unresolvedBlocking: advisoryComments.filter((comment) => comment.severity === "blocking" && !resolvedCommentIds.has(comment.id)).length,
      failures,
      contextArtifactCount: submission?.contextArtifacts.length ?? 0,
      repeatedAdvisories: repeatedArtifactReviewAdvisories(review),
      commentDispositions: round.commentDispositions ?? [],
      assignments: round.assignments.map((assignment) => ({
        id: assignment.id,
        actorId: assignment.actorId,
        actorName: assignment.actorName,
        slotNames: artifactReviewSlotNames(assignment.slotIds),
        actorKind: assignment.actorKind ?? "human",
        binding: assignment.binding,
        status: assignment.status,
        attempt: publicArtifactReviewAttempt(assignment.attempts?.at(-1)),
        vote: assignment.submitted?.vote,
        summary: assignment.submitted?.summary,
        implementationEvidenceReferenced: artifactReviewOpinionReferencesImplementation(assignment.submitted)
      })),
      runner: runnerCanDecide || runnerVote ? {
        actorName: "Runner",
        binding: "decision",
        status: runnerVote ? "submitted" : "pending",
        vote: runnerVote?.value,
        automatic: runnerVote?.automatic ?? false,
        comment: runnerVote?.comment
      } : undefined,
      result: round.result
    } : undefined
  };
}

async function findViewArtifactReview(
  config: MemsphereConfig,
  reviewId: string
): Promise<{ runsRoot: string; run: RunState; review: NonNullable<RunState["artifactReviews"]>[number] }> {
  const roots = [config.runsRoot, join(config.archiveRoot, "runs")];
  for (const runsRoot of roots) {
    try {
      await access(runsRoot);
      const located = await findArtifactReview({ runsRoot, reviewId });
      return { runsRoot, ...located };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      if (error instanceof Error && /Artifact Review not found/.test(error.message)) continue;
      throw error;
    }
  }
  throw new Error(`Artifact Review not found: ${reviewId}`);
}

async function readViewRunById(
  config: MemsphereConfig,
  runId: string
): Promise<{ runsRoot: string; run: RunState }> {
  if (!/^run-[a-zA-Z0-9-]+$/.test(runId)) throw new Error(`Run not found: ${runId}`);
  const archivedRunsRoot = join(config.archiveRoot, "runs");
  for (const candidateRoot of [config.runsRoot, archivedRunsRoot]) {
    try {
      const run = await readRun(candidateRoot, runId);
      return {
        runsRoot: candidateRoot,
        run: candidateRoot === archivedRunsRoot ? { ...run, readOnly: true } : run
      };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
  }
  throw new Error(`Run not found: ${runId}`);
}

function normalizeActivityInteger(value: string | null, fallback: number, name: string): number {
  if (value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`invalid Agent Activity ${name}`);
  return parsed;
}

async function artifactReviewContextPayload(
  runsRoot: string,
  context: Omit<ArtifactReviewContext, "assignment"> & { assignment?: ArtifactReviewContext["assignment"] }
): Promise<unknown> {
  const submission = context.review.submissions.find((candidate) => candidate.id === context.round.submissionId);
  if (!submission) throw new Error(`Artifact Review Submission not found: ${context.round.submissionId}`);
  const artifact = structuredClone(submission.artifact) as RunState["events"][number]["artifact"] & {
    content?: string;
    contentError?: string;
    renderedContent?: string;
    renderedContentType?: string;
  };
  await hydrateArtifactContent(runsRoot, context.run.id, artifact);
  const { authorization: _authorization, ...publicArtifact } = artifact;
  const reviewStep = findReviewStep(context.run, context.review.stepId);
  const contractArtifact = {
    name: "Frozen Review Contract",
    type: "object",
    format: { name: "json", options: {} },
    storage: "inline",
    value: {
      procedure: {
        name: context.run.procedureName,
        asserts: context.run.asserts ?? []
      },
      action: {
        instruction: reviewStep?.instruction ?? "",
        asserts: reviewStep?.asserts ?? [],
        suggests: reviewStep?.suggests ?? [],
        details: reviewStep?.details ?? []
      },
      artifact: {
        name: reviewStep?.artifact ?? context.review.artifactName,
        type: reviewStep?.type,
        format: reviewStep?.format,
        schema: reviewStep?.schema,
        final: reviewStep?.final ?? false,
        review: reviewStep?.reviewSlots ?? []
      }
    }
  };
  const contextArtifacts = structuredClone(submission.contextArtifacts);
  for (const item of contextArtifacts) {
    await hydrateArtifactContent(runsRoot, context.run.id, item.artifact);
    const { authorization: _authorization, ...publicContextArtifact } = item.artifact;
    item.artifact = publicContextArtifact as typeof item.artifact;
  }
  return {
    review: artifactReviewSummary(context.review, context.run.controlPlane),
    submission: {
      id: submission.id,
      digest: submission.digest,
      createdAt: submission.createdAt,
      artifact: publicArtifact,
      contractArtifact,
      contextArtifacts,
      revisionSummary: submission.revisionSummary
    },
    assignment: context.assignment ? {
      id: context.assignment.id,
      actorId: context.assignment.actorId,
      actorName: context.assignment.actorName,
      actorKind: context.assignment.actorKind ?? "human",
      slotIds: context.assignment.slotIds,
      binding: context.assignment.binding,
      status: context.assignment.status,
      draft: (context.assignment.actorKind ?? "human") === "agent"
        ? undefined
        : structuredClone(context.assignment.draft),
      submitted: publicArtifactReviewOpinion(context.assignment.submitted),
      attempts: context.assignment.attempts?.map(publicArtifactReviewAttempt),
      slotNames: artifactReviewSlotNames(context.assignment.slotIds)
    } : undefined,
    rounds: context.review.rounds.map((round) => ({
      id: round.id,
      sequence: round.sequence,
      submissionId: round.submissionId,
      status: round.status,
      revision: round.revision,
      createdAt: round.createdAt,
      bindingSource: round.bindingSource,
      assignments: round.assignments.map((assignment) => ({
        id: assignment.id,
        actorId: assignment.actorId,
        actorName: assignment.actorName,
        slotNames: artifactReviewSlotNames(assignment.slotIds),
        actorKind: assignment.actorKind ?? "human",
        slotIds: assignment.slotIds,
        binding: assignment.binding,
        status: assignment.status,
        submitted: publicArtifactReviewOpinion(assignment.submitted),
        implementationEvidenceReferenced: artifactReviewOpinionReferencesImplementation(assignment.submitted),
        attempts: assignment.attempts?.map(publicArtifactReviewAttempt)
      })),
      votes: round.votes.map(publicArtifactReviewVote),
      result: round.result,
      commentDispositions: structuredClone(round.commentDispositions ?? []),
      revisionSummary: context.review.submissions.find((submission) => submission.id === round.submissionId)?.revisionSummary
    }))
  };
}

function findReviewStep(run: RunState, stepId: string): RunStep | undefined {
  const visit = (steps: readonly RunStep[]): RunStep | undefined => {
    for (const step of steps) {
      if (step.id === stepId) return step;
      const nested = step.branches
        ? visit([...step.branches.truthy, ...step.branches.falsy])
        : step.loop
          ? visit(step.loop.body)
          : undefined;
      if (nested) return nested;
    }
    return undefined;
  };
  return visit(run.plan ?? []) ?? [...run.stack].reverse().map((frame) => visit(frame.steps)).find(Boolean);
}

function publicArtifactReviewAttempt(attempt: ArtifactReviewAgentAttempt | undefined): unknown {
  if (!attempt) return undefined;
  return {
    sequence: attempt.sequence,
    status: attempt.status,
    provider: attempt.provider,
    failure: attempt.failure ? {
      stage: attempt.failure.stage,
      code: attempt.failure.code,
      message: attempt.failure.message,
      category: artifactReviewFailureCategory(attempt.failure)
    } : undefined
  };
}

function publicArtifactReviewOpinion(opinion: ArtifactReviewSubmittedOpinion | undefined): unknown {
  if (!opinion) return undefined;
  return {
    comments: opinion.comments.map((comment) => ({
      ...structuredClone(comment),
      renderedBody: renderArtifactReviewMarkdown(comment.body)
    })),
    vote: opinion.vote,
    summary: opinion.summary,
    renderedSummary: opinion.summary ? renderArtifactReviewMarkdown(opinion.summary) : undefined,
    submittedAt: opinion.submittedAt
  };
}

function publicArtifactReviewVote(vote: ArtifactReviewVote): unknown {
  return {
    subject: vote.subject,
    binding: vote.binding,
    value: vote.value,
    automatic: vote.automatic,
    comment: vote.comment,
    renderedComment: vote.comment ? renderArtifactReviewMarkdown(vote.comment) : undefined,
    submittedAt: vote.submittedAt
  };
}

function renderArtifactReviewMarkdown(value: string): string {
  const normalized = !value.includes("\n") && value.includes("\\n\\n")
    ? value.replace(/\\r\\n|\\n/g, "\n")
    : value;
  return renderMarkdownContent(normalized);
}

function artifactReviewSlotNames(slotIds: string[]): string[] {
  return slotIds.map((slotId) => slotId.includes("::") ? slotId.slice(slotId.lastIndexOf("::") + 2) : slotId);
}

export async function hydrateRunArtifactContent(runsRoot: string, run: RunState): Promise<RunState> {
  const hydrated = parseRunState(JSON.parse(JSON.stringify(run)));
  for (const event of hydrated.events) {
    const artifact = event.artifact as RunState["events"][number]["artifact"] & {
      content?: string;
      contentError?: string;
      renderedContent?: string;
      renderedContentType?: string;
    };
    await hydrateArtifactContent(runsRoot, hydrated.id, artifact);
  }
  return hydrated;
}

async function hydrateArtifactContent(
  runsRoot: string,
  runId: string,
  artifact: RunState["events"][number]["artifact"] & {
    content?: string;
    contentError?: string;
    renderedContent?: string;
    renderedContentType?: string;
  }
): Promise<void> {
  if (artifact.storage === "file" && artifact.path && isTextArtifactFormat(artifact.format.name)) {
    try {
      artifact.content = await readFile(resolveRunArtifactPath(runsRoot, runId, artifact.path), "utf8");
    } catch (error) {
      artifact.contentError = error instanceof Error ? error.message : String(error);
    }
  }
  if (artifact.format.name === "markdown") {
    const value = artifact.content ?? artifact.value;
    if (typeof value === "string") {
      artifact.renderedContent = renderMarkdownContent(value);
      artifact.renderedContentType = "text/html";
    }
  }
}

export function renderMarkdownContent(value: string): string {
  try {
    return markdown.render(value).trim();
  } catch {
    return "";
  }
}

function createMarkdownRenderer(): MarkdownIt {
  const renderer = new MarkdownIt({
    html: false,
    linkify: false,
    breaks: true
  });
  renderer.enable(["table"]);
  renderer.validateLink = (url: string) => /^(https?:|mailto:)/i.test(url.trim());
  const defaultLinkOpen = renderer.renderer.rules.link_open;
  renderer.renderer.rules.link_open = (tokens, index, options, env, self) => {
    tokens[index]?.attrSet("target", "_blank");
    tokens[index]?.attrSet("rel", "noopener noreferrer nofollow");
    return defaultLinkOpen
      ? defaultLinkOpen(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options);
  };
  const defaultTableOpen = renderer.renderer.rules.table_open;
  renderer.renderer.rules.table_open = (tokens, index, options, env, self) => {
    const table = defaultTableOpen
      ? defaultTableOpen(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options);
    return `<div class="markdown-table-scroll">${table}`;
  };
  const defaultTableClose = renderer.renderer.rules.table_close;
  renderer.renderer.rules.table_close = (tokens, index, options, env, self) => {
    const table = defaultTableClose
      ? defaultTableClose(tokens, index, options, env, self)
      : self.renderToken(tokens, index, options);
    return `${table}</div>`;
  };
  return renderer;
}

function isTextArtifactFormat(format: string): boolean {
  return ["markdown", "yaml", "json", "schema", "string"].includes(format);
}

function resolveRunArtifactPath(runsRoot: string, runId: string, artifactPath: string): string {
  const artifactRoot = resolve(runsRoot, runId, "artifacts");
  const path = resolve(runsRoot, artifactPath);
  if (path !== artifactRoot && !path.startsWith(artifactRoot + sep)) {
    throw new Error(`invalid artifact path: ${artifactPath}`);
  }
  return path;
}

async function loadMemoryListItem(
  memoryRoot: string,
  kind: MemoryKind,
  path: string,
  systemReferences: ReadonlySet<string>
): Promise<MemoryPayload["memories"][number]> {
  const relativePath = portableRelative(memoryRoot, path);
  try {
    const file = await readMemoryFile(kind, path);
    const primaryName = Array.isArray(file.entity.names) ? file.entity.names[0] : file.path;
    return {
      id: `${file.kind}/${primaryName}`,
      kind: file.kind,
      path: relativePath,
      system: file.entity.names.some((name) => systemReferences.has(`${file.kind}/${name}`)),
      entity: file.entity
    };
  } catch (error) {
    return {
      id: `${kind}/${relativePath}`,
      kind,
      path: relativePath,
      system: false,
      error: formatMemoryLoadError(error)
    };
  }
}

function portableRelative(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

function globalSettingsPayload(
  document: GlobalConfigDocument,
  runningRevision: string,
  runningView: MemsphereConfig["view"],
  projects: ProjectConfigReference[]
): Record<string, unknown> {
  const diskView = document.raw.view ?? { host: "127.0.0.1", port: 0 };
  return {
    configPath: document.configPath,
    scopeRoot: document.scopeRoot,
    runningRevision,
    runningView: { host: runningView.host, port: runningView.port },
    diskRevision: document.revision,
    restartRequired: !sameViewConfig(diskView, runningView),
    operatorTokenConfigured: Boolean(document.raw.view?.operator_token),
    explicit: {
      language: Object.hasOwn(document.raw, "language"),
      view: Object.hasOwn(document.raw, "view"),
      acpProviders: Object.hasOwn(document.raw, "acp_providers")
    },
    config: editableGlobalConfigDraft(document),
    defaults: {
      language: "zh-CN",
      view: { host: "127.0.0.1", port: 0 }
    },
    acpProviderCatalog: listAcpProviderDefinitions().map((definition) => ({
      ...localizeAcpProviderDefinition(definition, document.raw.language),
      defaultInstance: defaultAcpProviderInstance(definition.type)
    })),
    providerReferences: providerReferenceMap(projects)
  };
}

function sameViewConfig(
  left: { host: string; port: number; operator_token?: string },
  right: MemsphereConfig["view"]
): boolean {
  return left.host === right.host && left.port === right.port &&
    left.operator_token === right.operatorToken;
}

function projectSettingsPayload(document: ProjectConfigDocument): Record<string, unknown> {
  return {
    configPath: document.configPath,
    projectName: document.resolved.project?.name,
    scopeRoot: document.scopeRoot,
    diskRevision: document.revision,
    restartRequired: false,
    explicit: { controlPlane: Object.hasOwn(document.raw, "control_plane") },
    config: editableProjectConfigDraft(document),
    store: document.raw.store,
    resolvedPaths: {
      memoryRoot: document.resolved.memoryRoot,
      runsRoot: document.resolved.runsRoot,
      archiveRoot: document.resolved.archiveRoot
    },
    permissionCatalog: listPermissionDefinitions()
      .filter((definition) => !hiddenSettingsPermissionIds.has(definition.id))
  };
}

function readGlobalSettingsDocument(config: MemsphereConfig): Promise<GlobalConfigDocument> {
  return readGlobalConfigDocument(homePaths(config.homeRoot).configPath);
}

function readCurrentProjectSettingsDocument(config: MemsphereConfig): Promise<ProjectConfigDocument | undefined> {
  if (!config.project?.name) return Promise.resolve(undefined);
  return readProjectConfigDocument(config.configPath, config);
}

async function readRegisteredProjectConfigs(home?: string): Promise<ProjectConfigReference[]> {
  const projects = (await listRegisteredProjects(home)).filter((project) => !project.missing);
  return Promise.all(projects.map(async (project) => ({
    name: project.name,
    config: parseProjectConfigSource(await readFile(join(project.root, "config.json"), "utf8"))
  })));
}

function providerReferenceMap(projects: ProjectConfigReference[]): Record<string, Array<{
  projectName: string;
  actorId: string;
  actorName?: string;
}>> {
  const references: Record<string, Array<{ projectName: string; actorId: string; actorName?: string }>> = {};
  for (const project of projects) {
    for (const [actorId, actor] of Object.entries(project.config.control_plane?.actors ?? {})) {
      if (actor.kind !== "agent" || !actor.agent?.provider) continue;
      const reference = {
        projectName: project.name,
        actorId,
        ...(actor.name ? { actorName: actor.name } : {})
      };
      (references[actor.agent.provider] ??= []).push(reference);
    }
  }
  return references;
}

function authorizeSettingsRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: MemsphereConfig,
  options: ViewServerOptions,
  verifyOrigin = false
): boolean {
  if (verifyOrigin) {
    const rejection = jsonMutationOriginRejection(request, config, "Settings");
    if (rejection) {
      sendJson(response, 403, { code: "request_origin_rejected", error: rejection });
      return false;
    }
  }

  if (isLoopbackHost(config.view.host)) return true;
  const expected = options.settingsToken;
  const authorization = request.headers.authorization;
  const provided = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!expected || !constantTimeEqual(provided, expected)) {
    sendJson(response, 401, { code: "unauthorized", error: "Settings operator token is required" });
    return false;
  }
  return true;
}

function jsonMutationOriginRejection(
  request: IncomingMessage,
  config: MemsphereConfig,
  subject: string
): string | undefined {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return `${subject} requests must use application/json`;

  const originHeader = request.headers.origin;
  const hostHeader = request.headers.host;
  if (!originHeader || !hostHeader) return `${subject} requests require Origin and Host headers`;

  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    return `${subject} request Origin is invalid`;
  }
  if (!["http:", "https:"].includes(origin.protocol) || origin.host.toLowerCase() !== hostHeader.toLowerCase()) {
    return `${subject} request Origin must match the current View origin`;
  }

  const fetchSite = request.headers["sec-fetch-site"];
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return `Cross-site ${subject} requests are not allowed`;
  }

  if (isLoopbackHost(config.view.host) && !isLoopbackRequestHost(origin.hostname)) {
    return `Loopback ${subject} requests must use a loopback hostname`;
  }
  return undefined;
}

function isLoopbackRequestHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

async function readJsonBody<T>(request: IncomingMessage, limit = 512 * 1024): Promise<T> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.length;
    if (total > limit) {
      throw new Error("request body is too large");
    }
    chunks.push(buffer);
  }

  if (!chunks.length) {
    return {} as T;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

function normalizeExpectedRevision(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new Error("expectedRevision must be a non-negative integer");
  }
  return Number(value);
}

function normalizeArtifactReviewDraft(input: { vote?: unknown; comments?: unknown }): ArtifactReviewDraftInput {
  const vote = input.vote === undefined
    ? undefined
    : input.vote === "approve" || input.vote === "request_changes" || input.vote === "abstain"
      ? input.vote
      : (() => { throw new Error("invalid Artifact Review vote"); })();
  if (!Array.isArray(input.comments)) throw new Error("Artifact Review comments must be an array");
  const comments = input.comments.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid Artifact Review comment");
    }
    const comment = value as Record<string, unknown>;
    if (typeof comment.body !== "string") throw new Error("Artifact Review comment body must be a string");
    const severity = comment.severity;
    if (severity !== undefined && severity !== "blocking" && severity !== "risk" && severity !== "suggestion") {
      throw new Error("Artifact Review comment severity must be blocking, risk, or suggestion");
    }
    let anchor: ArtifactReviewDraftInput["comments"][number]["anchor"];
    if (comment.anchor !== undefined) {
      if (!comment.anchor || typeof comment.anchor !== "object" || Array.isArray(comment.anchor)) {
        throw new Error("invalid Artifact Review comment anchor");
      }
      const candidate = comment.anchor as Record<string, unknown>;
      if (
        typeof candidate.submissionId !== "string"
        || typeof candidate.target !== "string"
        || typeof candidate.sourceHash !== "string"
      ) {
        throw new Error("Artifact Review comment anchor requires submissionId, target, and sourceHash");
      }
      anchor = {
        submissionId: candidate.submissionId,
        target: candidate.target,
        sourceHash: candidate.sourceHash,
        location: typeof candidate.location === "string" ? candidate.location : undefined,
        context: typeof candidate.context === "string" ? candidate.context : undefined
      };
    }
    return {
      id: typeof comment.id === "string" ? comment.id : undefined,
      body: comment.body,
      severity: severity as ArtifactReviewDraftInput["comments"][number]["severity"],
      anchor
    };
  });
  return { vote, comments };
}

function sendArtifactReviewError(response: ServerResponse, error: unknown): void {
  if (error instanceof ArtifactReviewConflictError) {
    sendJson(response, 409, {
      error: error.message,
      roundId: error.roundId,
      actualRevision: error.actualRevision
    });
    return;
  }
  if (error instanceof ArtifactAuthorizationFailure) {
    sendJson(response, 403, { error: error.message, decision: error.decision });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  const status = /not found/i.test(message) ? 404 : /not assigned|read-only/i.test(message) ? 403 : 400;
  sendJson(response, status, { error: message });
}


function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function formatMemoryLoadError(error: unknown): MemoryLoadError {
  if (error instanceof ZodError) {
    const issues = summarizeZodIssues(error.issues);
    return {
      message: "This memory does not match the current memsphere YAML model.",
      issues
    };
  }

  return {
    message: "This memory could not be loaded.",
    issues: [formatError(error)]
  };
}

function summarizeZodIssues(issues: ZodIssue[]): string[] {
  const summary: string[] = [];
  const seen = new Set<string>();

  for (const issue of issues) {
    const text = summarizeZodIssue(issue);
    if (seen.has(text)) continue;
    seen.add(text);
    summary.push(text);
    if (summary.length >= 8) break;
  }

  const omitted = issues.length - summary.length;
  if (omitted > 0) {
    summary.push(`还有 ${omitted} 个类似问题，建议先运行 memsphere validate 查看完整列表。`);
  }

  return summary;
}

function summarizeZodIssue(issue: ZodIssue): string {
  const path = issue.path.join(".") || "(root)";

  if (issue.code === "invalid_union" && issue.path[0] === "flow" && typeof issue.path[1] === "number") {
    return `${path}: 流程步骤不符合当前 DSL。请使用 { action, artifact }，或 !if / !while / !call 结构。`;
  }

  if (issue.code === "invalid_type") {
    return `${path}: 类型不正确，期望 ${issue.expected}，实际 ${issue.received}。`;
  }

  if (issue.code === "unrecognized_keys") {
    return `${path}: 出现了当前模型不认识的字段：${issue.keys.join(", ")}。`;
  }

  return `${path}: ${issue.message}`;
}


function sendHtml(response: ServerResponse, body: string): void {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}

const compiledViewSdkUrl = new URL("../view/view-sdk.js", import.meta.url);
const compiledViewRuntimeUrl = new URL("../view/view-runtime.js", import.meta.url);
const sourceViewSdkUrl = new URL("../view/view-sdk.ts", import.meta.url);
const sourceViewRuntimeUrl = new URL("../view/view-runtime.ts", import.meta.url);
const viewRuntimeDependencies = new Map([
  ["/assets/system-icon.js", {
    compiled: new URL("../view/system-icon.js", import.meta.url),
    source: new URL("../view/system-icon.ts", import.meta.url)
  }],
  ["/assets/theme.js", {
    compiled: new URL("../view/theme.js", import.meta.url),
    source: new URL("../view/theme.ts", import.meta.url)
  }],
  ["/assets/ui-primitives.js", {
    compiled: new URL("../view/ui-primitives.js", import.meta.url),
    source: new URL("../view/ui-primitives.ts", import.meta.url)
  }],
  ["/assets/core-plugin.js", {
    compiled: new URL("../view/core-plugin.js", import.meta.url),
    source: new URL("../view/core-plugin.ts", import.meta.url)
  }],
  ["/assets/core-routes.js", {
    compiled: new URL("../view/core-routes.js", import.meta.url),
    source: new URL("../view/core-routes.ts", import.meta.url)
  }],
  ["/assets/shell/home.js", {
    compiled: new URL("../view/shell/home.js", import.meta.url),
    source: new URL("../view/shell/home.ts", import.meta.url)
  }]
]);

const viewSdkVersion = "1.0.0";

function builtinAssetPath(moduleId: string): string {
  return `/assets/modules/${encodeURIComponent(moduleId)}/index.js`;
}

function builtinModuleAsset(pathname: string) {
  return builtinModuleCatalog.find(entry => builtinAssetPath(entry.moduleId) === pathname);
}

async function builtinViewInstances(config: MemsphereConfig): Promise<readonly ViewHostBootInstance[]> {
  return Promise.all(builtinModuleCatalog.map(async entry => {
    const { manifest } = await readBuiltinViewManifest(entry.packageDirectory, entry.moduleId);
    return {
      pluginPath: builtinAssetPath(entry.moduleId),
      routeGrants: entry.routes,
      home: {
        title: entry.title,
        summary: entry.summary,
        icon: entry.icon,
        routeId: entry.homeRouteId,
        ...(entry.moduleId === "org.memsphere.settings" ? { routeParams: { module: "general" } } : {})
      },
      module: {
        projectId: config.project?.name ?? "memsphere",
        moduleId: entry.moduleId,
        moduleVersion: manifest.version,
        instanceId: entry.instanceId
      }
    };
  }));
}

async function readBuiltinViewManifest(packageDirectory: string, expectedModuleId: string) {
  const packageUrl = import.meta.url.endsWith(".ts")
    ? new URL(`../../modules/${packageDirectory}/`, import.meta.url)
    : new URL(`../modules/${packageDirectory}/`, import.meta.url);
  const manifest = await readModuleManifest(fileURLToPath(new URL("module.json", packageUrl)));
  if (manifest.id !== expectedModuleId) throw new Error(`Builtin Module id does not match catalog: ${expectedModuleId}`);
  if (!isViewSdkCompatible(manifest, viewSdkVersion)) throw new Error(`Builtin Module requires incompatible View SDK: ${manifest.view.sdk}`);
  return { manifest, packageUrl };
}

async function readBuiltinViewBundle(packageDirectory: string, expectedModuleId: string): Promise<string> {
  const { manifest, packageUrl } = await readBuiltinViewManifest(packageDirectory, expectedModuleId);
  const compiledPath = resolveModuleViewEntry(fileURLToPath(packageUrl), manifest);
  try {
    const bundle = await readFile(compiledPath, "utf8");
    if (!bundle.trim()) throw new Error(`Builtin View bundle is empty: ${compiledPath}`);
    return bundle;
  } catch (error) {
    if (!(import.meta.url.endsWith(".ts") && error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
    const [{ build }, source] = await Promise.all([
      import("esbuild"),
      Promise.resolve(new URL(`../../modules/${packageDirectory}/adapter/view/index.ts`, import.meta.url))
    ]);
    const result = await build({
      entryPoints: [fileURLToPath(source)], bundle: true, write: false, format: "esm", platform: "browser",
      target: "es2022", external: ["@memsphere/view-sdk"], logLevel: "silent"
    });
    const bundle = result.outputFiles[0]?.text;
    if (!bundle?.trim()) throw new Error(`Builtin View source bundle is empty: ${source.pathname}`);
    return bundle;
  }
}

async function readCompiledBrowserModule(compiledUrl: URL, sourceUrl: URL): Promise<string> {
  try {
    const source = await readFile(compiledUrl, "utf8");
    if (!source.trim()) throw new Error(`View browser module is empty: ${compiledUrl.pathname}`);
    return source;
  } catch (error) {
    if (
      import.meta.url.endsWith(".ts")
      && error && typeof error === "object" && "code" in error && error.code === "ENOENT"
    ) {
      const [{ transpileModule, ModuleKind, ScriptTarget }, source] = await Promise.all([
        import("typescript"),
        readFile(sourceUrl, "utf8")
      ]);
      return transpileModule(source, {
        compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2022 }
      }).outputText;
    }
    throw error;
  }
}

function sendJavaScript(request: IncomingMessage, response: ServerResponse, body: string): void {
  const etag = `"${createHash("sha256").update(body).digest("base64url")}"`;
  const commonHeaders = {
    "cache-control": "no-cache",
    "etag": etag,
    "vary": "Accept-Encoding",
    "x-content-type-options": "nosniff"
  };
  if (request.headers["if-none-match"] === etag) {
    response.writeHead(304, commonHeaders);
    response.end();
    return;
  }
  const gzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(request.headers["accept-encoding"] ?? "");
  const payload = gzip ? gzipSync(body) : body;
  response.writeHead(200, {
    "content-type": "text/javascript; charset=utf-8",
    ...commonHeaders,
    ...(gzip ? { "content-encoding": "gzip" } : {}),
    "content-length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

async function sendSystemIcon(response: ServerResponse, name: string): Promise<void> {
  const supportedRegular = new Set([
    "archive", "arrow-right", "arrows-clockwise", "brain", "caret-down", "check-circle", "circle-fill", "clock-counter-clockwise", "code", "cube", "file-text", "folder", "gear-six", "house", "magnifying-glass", "play-circle", "plus", "seal-check", "sliders-horizontal", "sparkle", "stack", "storefront", "user", "warning-circle", "x"
  ]);
  const weighted = name.match(/^(brain|circle|cube|gear-six|house|play-circle|seal-check|stack)-(duotone|fill)$/);
  if (!supportedRegular.has(name) && !weighted) {
    sendText(response, 404, "Icon not found");
    return;
  }
  const iconUrl = weighted
    ? import.meta.resolve(`@phosphor-icons/core/${weighted[2]}/${weighted[1]}-${weighted[2]}.svg`)
    : import.meta.resolve(`@phosphor-icons/core/regular/${name}.svg`);
  const body = await readFile(fileURLToPath(iconUrl), "utf8");
  response.writeHead(200, {
    "content-type": "image/svg+xml; charset=utf-8",
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff"
  });
  response.end(body);
}

export function isViewPagePath(pathname: string): boolean {
  return coreViewRoutes.some(route => matchesViewRoute(route.path, pathname))
    || builtinModuleCatalog.some(module => module.routes.some(route => (
    [route.path, ...(route.aliases ?? [])].some(pattern => matchesViewRoute(pattern, pathname))
  )));
}

function matchesViewRoute(pattern: string, pathname: string): boolean {
  if (pattern === "/" || pathname === "/") return pattern === pathname;
  const expected = pattern.split("/").filter(Boolean);
  const actual = pathname.split("/").filter(Boolean);
  return expected.length === actual.length && expected.every((segment, index) => (
    segment.startsWith(":") ? Boolean(actual[index]) : segment === actual[index]
  ));
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(body, null, 2));
}

function sendText(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(body);
}
const hiddenSettingsPermissionIds = new Set(["decision.challenge", "decision.override"]);
