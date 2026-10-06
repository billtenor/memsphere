import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, dirname, isAbsolute, resolve } from "node:path";
import spawn from "cross-spawn";
import semver from "semver";
import { z } from "zod";
import { atomicWriteJson } from "../persistence.js";
import { AppError, cliBindingSchema, cliDescriptorSchema } from "../app/contracts.js";
import { digest, isMissing, readJson } from "../app/files.js";
import { assertWritableAppTarget, readAppState, requireApp, withAppLock, writeAppState, type AppProject } from "../app/state.js";
import type { ProjectContext, ResolvedProject } from "../project/resolver.js";

const registrySchema = z.object({ schemaVersion: z.literal(1), descriptors: z.record(cliDescriptorSchema), bindings: z.record(cliBindingSchema) }).strict();
const registryPath = (p: AppProject) => resolve(p.paths.root, "tools", `${digest(p.memoryRoot)}.json`);
async function readRegistry(p: AppProject) {
  try { return registrySchema.parse(await readJson(registryPath(p))); }
  catch (error) { if (isMissing(error)) return registrySchema.parse({ schemaVersion: 1, descriptors: {}, bindings: {} }); throw error; }
}
export async function cliCatalog(project: AppProject) {
  const registry = await readRegistry(project);
  const state = await readAppState(project);
  const owners = new Map<string, string[]>();
  for (const [id, app] of Object.entries(state.installations)) for (const descriptor of app.descriptors) {
    const old = registry.descriptors[descriptor.id];
    if (old && JSON.stringify(old) !== JSON.stringify(descriptor)) throw new AppError("CLI_CONFLICT", `Conflicting CLI: ${descriptor.id}`);
    registry.descriptors[descriptor.id] = descriptor;
    owners.set(descriptor.id, [...(owners.get(descriptor.id) ?? []), id]);
  }
  for (const [id, app] of Object.entries(state.installations)) for (const dep of app.manifest.dependencies.filter(d => d.kind === "cli"))
    owners.set(dep.id, [...new Set([...(owners.get(dep.id) ?? []), id])]);
  return { registry, state, owners };
}
export async function registerCli(context: ProjectContext, file: string, target: ResolvedProject = context.primary) {
  assertWritableAppTarget(context, target);
  const descriptor = cliDescriptorSchema.parse(await readJson(file));
  return withAppLock(target, async () => {
    const { registry: catalog } = await cliCatalog(target);
    if (Object.hasOwn(catalog.descriptors, descriptor.id)) {
      if (JSON.stringify(catalog.descriptors[descriptor.id]) !== JSON.stringify(descriptor)) throw new AppError("CLI_CONFLICT", `Conflicting CLI: ${descriptor.id}`);
      return { id: descriptor.id, status: "unchanged" };
    }
    const registry = await readRegistry(target);
    registry.descriptors[descriptor.id] = descriptor;
    await atomicWriteJson(registryPath(target), registry);
    return { id: descriptor.id, status: "registered" };
  });
}
export async function bindCli(context: ProjectContext, id: string, file: string, appId?: string, target = context.primary) {
  assertWritableAppTarget(context, target);
  const binding = cliBindingSchema.parse(await readJson(file));
  const base = dirname(resolve(file));
  if (binding.executable && (binding.executable.includes("/") || binding.executable.includes("\\"))) binding.executable = resolve(base, binding.executable);
  if (binding.cwd) binding.cwd = resolve(base, binding.cwd);
  if (binding.files) binding.files = binding.files.map(path => resolve(base, path));
  return withAppLock(target, async () => {
    const { registry, state, owners } = await cliCatalog(target);
    if (!Object.hasOwn(registry.descriptors, id)) throw new AppError("CLI_NOT_FOUND", `CLI not registered: ${id}`);
    if (appId) {
      const app = requireApp(state, appId);
      if (!owners.get(id)?.includes(appId)) throw new AppError("CLI_NOT_IN_APP", `${id} is not declared by ${appId}`);
      // A local override retains manifest-derived business arguments unless explicitly replaced.
      app.bindings[id] = { ...app.bindings[id], ...binding };
      app.bindingOverrides ??= {};
      app.bindingOverrides[id] = { ...app.bindingOverrides[id], ...binding };
      await writeAppState(target, state);
    } else {
      const independent = await readRegistry(target);
      independent.bindings[id] = binding;
      await atomicWriteJson(registryPath(target), independent);
    }
    return { id, project: target.name, app: appId, status: "bound" };
  });
}
export async function showCli(project: AppProject, id: string, appId?: string) {
  appId && appId.length && requireApp(await readAppState(project), appId);
  const { registry, state, owners } = await cliCatalog(project);
  if (!Object.hasOwn(registry.descriptors, id)) throw new AppError("CLI_NOT_FOUND", `CLI not registered: ${id}`);
  const descriptor = registry.descriptors[id];
  const apps = owners.get(id) ?? [];
  if (appId && !apps.includes(appId)) throw new AppError("CLI_NOT_IN_APP", `${id} is not declared by ${appId}`);
  const binding = appId ? requireApp(state, appId).bindings[id] : registry.bindings[id];
  const unresolved = !appId && apps.length > 0 && !binding;
  const disabled = appId ? !requireApp(state, appId).enabled : false;
  return { id, project: project.name, app: appId, descriptor, apps, binding,
    status: unresolved ? "unresolved" : appId && !binding ? "unbound" : disabled ? "disabled" : "unchecked",
    invocation: unresolved || appId && !binding ? undefined : {
      executable: binding?.executable ?? descriptor.command[0],
      args: [...descriptor.command.slice(1), ...(binding?.args ?? [])], cwd: binding?.cwd, env: binding?.env, envFrom: binding?.envFrom
    } };
}
export async function listClis(project: AppProject, appId?: string) {
  const { registry, state, owners } = await cliCatalog(project);
  if (appId) requireApp(state, appId);
  const ids = new Set([...Object.keys(registry.descriptors), ...owners.keys()]);
  return Promise.all([...ids].sort().filter(id => !appId || owners.get(id)?.includes(appId)).map(async id =>
    Object.hasOwn(registry.descriptors, id) ? showCli(project, id, appId)
      : { id, status: "missing", apps: owners.get(id) }));
}
export async function resolveExecutable(command: string, cwd?: string): Promise<string | undefined> {
  const explicit = isAbsolute(command) || command.includes("/") || command.includes("\\");
  const bases = explicit ? [resolve(cwd ?? process.cwd(), command)] : (process.env.PATH ?? "").split(delimiter).filter(Boolean).map(dir => resolve(dir, command));
  const suffixes = process.platform === "win32" ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")] : [""];
  for (const base of bases) for (const suffix of suffixes) {
    const path = base + suffix;
    try { if ((await stat(path)).isFile()) { await access(path, constants.X_OK); return path; } }
    catch (error) { if (!isMissing(error) && (error as NodeJS.ErrnoException).code !== "EACCES") throw error; }
  }
  return undefined;
}
export type CheckItem = { name: string; status: "available" | "unavailable" | "unknown"; message?: string };
export async function checkCli(project: AppProject, id: string, appId?: string, options: { allowDisabled?: boolean } = {}) {
  const shown = await showCli(project, id, appId);
  const items: CheckItem[] = [];
  const add = (name: string, ok: boolean, message?: string) => items.push({ name, status: ok ? "available" : "unavailable", message });
  if (!shown.invocation) items.push({ name: "binding", status: "unknown", message: "Select an App and provide its own binding" });
  if (shown.status === "disabled" && !options.allowDisabled) add("app", false, "App is disabled");
  if (shown.invocation) {
    const { invocation, descriptor, binding } = shown;
    const environment = { ...invocation.env };
    for (const [name, source] of Object.entries(invocation.envFrom ?? {})) {
      add(`envFrom:${name}`, Boolean(process.env[source]), source);
      if (process.env[source]) environment[name] = process.env[source]!;
    }
    const executable = await resolveExecutable(invocation.executable, invocation.cwd);
    add("executable", Boolean(executable));
    if (invocation.cwd || descriptor.requirements?.cwd) {
      let exists = false;
      if (invocation.cwd) try { exists = (await stat(invocation.cwd)).isDirectory(); } catch (error) { if (!isMissing(error)) throw error; }
      add("cwd", exists);
    }
    for (const name of descriptor.requirements?.env ?? []) add(`env:${name}`, Boolean(environment[name] ?? process.env[name]));
    for (const file of [...(descriptor.requirements?.files ?? []), ...(binding?.files ?? [])]) {
      const path = resolve(invocation.cwd ?? project.paths.root, file);
      try { await access(path, constants.R_OK); add(`file:${file}`, (await stat(path)).isFile()); }
      catch (error) { if (!isMissing(error) && (error as NodeJS.ErrnoException).code !== "EACCES") throw error; add(`file:${file}`, false); }
    }
    const app = appId ? requireApp(await readAppState(project), appId) : undefined;
    const ranges = [descriptor.requirements?.version, ...app?.manifest.dependencies.filter(d => d.kind === "cli" && d.id === id).map(d => d.version) ?? []].filter((v): v is string => Boolean(v));
    if (!descriptor.versionProbe && ranges.length) items.push({ name: "version", status: "unknown", message: "No versionProbe declared" });
    else if (descriptor.versionProbe && executable && items.every(item => item.status === "available")) {
      try {
        const result = await probe(executable, [...descriptor.command.slice(1), ...descriptor.versionProbe.args], invocation.cwd, environment);
        const v = semver.valid(result.trim());
        if (!v) items.push({ name: "version", status: "unknown", message: "Probe did not return a SemVer version" });
        else add("version", ranges.every(range => semver.satisfies(v, range)), v);
      } catch (error) { add("version", false, String(error)); }
    }
  }
  return { id, app: appId, checkedAt: new Date().toISOString(), status: items.some(i => i.status === "unavailable") ? "unavailable"
    : items.some(i => i.status === "unknown") ? "unknown" : "available", items };
}
function probe(executable: string, args: string[], cwd?: string, env?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: { ...process.env, ...env }, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", bytes = 0, done = false;
    const finish = (error?: Error) => {
      if (done) return; done = true; clearTimeout(timer);
      if (error) { child.kill("SIGKILL"); reject(error); } else resolve(stdout);
    };
    const timer = setTimeout(() => finish(new Error("CLI version probe timed out")), 5000);
    child.stdout?.on("data", (b: Buffer) => { stdout += b.toString(); bytes += b.length; if (bytes > 65536) finish(new Error("CLI version probe output exceeded limit")); });
    child.stderr?.on("data", (b: Buffer) => { bytes += b.length; if (bytes > 65536) finish(new Error("CLI version probe output exceeded limit")); });
    child.on("error", finish);
    child.on("close", code => finish(code === 0 ? undefined : new Error(`CLI version probe exited ${code}`)));
  });
}
