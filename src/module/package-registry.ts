import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { satisfies } from "semver";
import {
  isViewSdkCompatible,
  readModuleManifest,
  resolveModulePackageFile,
  resolveModuleViewEntry,
  type ModuleManifest
} from "./manifest.js";
import type {
  GlobalViewPackagesConfig,
  ProjectViewConfig,
  ViewPackageCapability
} from "../view/package-config.js";

export const OFFICIAL_VIEW_CANDIDATE_PRIORITY = 1000;

export type ViewPackageDiagnosticState =
  | "resolved"
  | "invalid"
  | "incompatible"
  | "duplicate_identity"
  | "missing_dependency"
  | "capability_denied"
  | "disabled"
  | "conflicted";

export interface ViewPackageDiagnostic {
  readonly path?: string;
  readonly packageId?: string;
  readonly version?: string;
  readonly instanceId?: string;
  readonly state: ViewPackageDiagnosticState;
  readonly message?: string;
}

export interface InstalledViewPackage {
  readonly root: string;
  readonly manifest: ModuleManifest;
  readonly entryPath: string;
  readonly homeAllow: ReadonlySet<ViewPackageCapability>;
}

export interface ResolvedViewPackageInstance {
  readonly package: InstalledViewPackage;
  readonly instanceId: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly allow: ReadonlySet<ViewPackageCapability>;
  readonly contributionPolicy: {
    readonly priorities: Readonly<Record<string, readonly [number, number]>>;
    readonly blockedCells: readonly string[];
  };
}

export interface ResolvedViewPackageComposition {
  readonly installed: readonly InstalledViewPackage[];
  readonly instances: readonly ResolvedViewPackageInstance[];
  readonly diagnostics: readonly ViewPackageDiagnostic[];
}

export interface ViewPackageAsset {
  readonly key: string;
  readonly projectId: string;
  readonly instanceId: string;
  readonly path: string;
  readonly digest: string;
  readonly mime: string;
}

const assetMime = new Map<string, string>([
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"]
]);

export async function resolveViewPackageComposition(input: {
  readonly global?: GlobalViewPackagesConfig;
  readonly project?: ProjectViewConfig;
  readonly sdkVersion: string;
}): Promise<ResolvedViewPackageComposition> {
  const diagnostics: ViewPackageDiagnostic[] = [];
  const installed: InstalledViewPackage[] = [];
  const identities = new Map<string, InstalledViewPackage>();

  for (const record of input.global?.installed ?? []) {
    try {
      const root = await realpath(resolve(record.path));
      if (!(await stat(root)).isDirectory()) throw new Error("View Package path is not a directory");
      const manifest = await readModuleManifest(join(root, "module.json"));
      const identity = `${manifest.id}@${manifest.version}`;
      if (identities.has(identity)) {
        diagnostics.push({ path: root, packageId: manifest.id, version: manifest.version, state: "duplicate_identity" });
        continue;
      }
      if (!isViewSdkCompatible(manifest, input.sdkVersion)) {
        diagnostics.push({
          path: root,
          packageId: manifest.id,
          version: manifest.version,
          state: "incompatible",
          message: `requires View SDK ${manifest.view.sdk}`
        });
        continue;
      }
      const entryPath = await safePackageFile(root, resolveModuleViewEntry(root, manifest));
      const packageRecord = Object.freeze({
        root,
        manifest,
        entryPath,
        homeAllow: new Set(record.allow ?? []) as ReadonlySet<ViewPackageCapability>
      });
      identities.set(identity, packageRecord);
      installed.push(packageRecord);
      diagnostics.push({ path: root, packageId: manifest.id, version: manifest.version, state: "resolved" });
    } catch (error) {
      diagnostics.push({
        path: record.path,
        state: "invalid",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const selected = (input.project?.packages ?? []).map((config) => ({
    config,
    package: identities.get(`${config.id}@${config.version}`)
  }));
  const selectedIdentities = new Map(selected.filter(item => item.package).map(item => [
    item.package!.manifest.id,
    item.package!.manifest.version
  ]));
  const candidates: Array<{
    config: NonNullable<typeof input.project>["packages"][number];
    package: InstalledViewPackage;
    instanceId: string;
    blockedCells: Set<string>;
  }> = [];

  for (const item of selected) {
    const instanceId = item.config.instance_id ?? item.config.id;
    if (!item.config.enabled) {
      diagnostics.push({ packageId: item.config.id, version: item.config.version, instanceId, state: "disabled" });
      continue;
    }
    if (!item.package) {
      diagnostics.push({
        packageId: item.config.id,
        version: item.config.version,
        instanceId,
        state: "invalid",
        message: "installed View Package version was not found"
      });
      continue;
    }
    const missing = (item.package.manifest.view.dependencies ?? []).find(dependency => {
      const version = selectedIdentities.get(dependency.id);
      return !version || !satisfies(version, dependency.version, { includePrerelease: true });
    });
    if (missing) {
      diagnostics.push({
        packageId: item.config.id,
        version: item.config.version,
        instanceId,
        state: "missing_dependency",
        message: `requires ${missing.id}@${missing.version}`
      });
      continue;
    }
    candidates.push({ config: item.config, package: item.package, instanceId, blockedCells: new Set() });
  }

  const contributionGroups = new Map<string, Array<{ candidate: typeof candidates[number]; id: string }>>();
  for (const candidate of candidates) {
    for (const contribution of candidate.package.manifest.view.contributions ?? []) {
      const key = `${contribution.cell}\0${contribution.priority}`;
      const group = contributionGroups.get(key) ?? [];
      group.push({ candidate, id: `${candidate.package.manifest.id}:${candidate.instanceId}:${contribution.id}` });
      contributionGroups.set(key, group);
    }
  }

  const ranks = new Map<string, readonly [number, number]>();
  for (const [groupKey, group] of contributionGroups) {
    const separator = groupKey.lastIndexOf("\0");
    const cell = groupKey.slice(0, separator);
    const declared = Number(groupKey.slice(separator + 1));
    if (group.length === 1) {
      ranks.set(group[0]!.id, [declared, 0]);
      continue;
    }
    const preferences = new Set(group.map(({ candidate }) => candidate.config.preferences?.[cell]).filter(Boolean));
    const preferred = preferences.size === 1 ? [...preferences][0] : undefined;
    if (!preferred || !group.some(item => item.id === preferred)) {
      for (const item of group) item.candidate.blockedCells.add(cell);
      continue;
    }
    const ordered = [...group].sort((left, right) => {
      if (left.id === preferred) return -1;
      if (right.id === preferred) return 1;
      return left.id.localeCompare(right.id);
    });
    ordered.forEach((item, rank) => ranks.set(item.id, [declared, rank]));
  }

  const instances = candidates.map((candidate): ResolvedViewPackageInstance => {
    const priorities: Record<string, readonly [number, number]> = {};
    for (const contribution of candidate.package.manifest.view.contributions ?? []) {
      const identity = `${candidate.package.manifest.id}:${candidate.instanceId}:${contribution.id}`;
      const priority = ranks.get(identity);
      if (priority) priorities[identity] = priority;
    }
    if (candidate.blockedCells.size) {
      diagnostics.push({
        packageId: candidate.package.manifest.id,
        version: candidate.package.manifest.version,
        instanceId: candidate.instanceId,
        state: "conflicted",
        message: `unresolved contributions: ${[...candidate.blockedCells].sort().join(", ")}`
      });
    }
    const projectAllow = new Set(candidate.config.allow ?? []);
    const declared = new Set(candidate.package.manifest.view.capabilities ?? []);
    const allow = new Set([...candidate.package.homeAllow].filter(capability => (
      declared.has(capability) && projectAllow.has(capability)
    )));
    for (const capability of declared) {
      if (allow.has(capability)) continue;
      diagnostics.push({
        packageId: candidate.package.manifest.id,
        version: candidate.package.manifest.version,
        instanceId: candidate.instanceId,
        state: "capability_denied",
        message: `capability requires both Home and Project grants: ${capability}`
      });
    }
    return Object.freeze({
      package: candidate.package,
      instanceId: candidate.instanceId,
      config: Object.freeze(structuredClone(candidate.config.config ?? {})),
      allow,
      contributionPolicy: Object.freeze({
        priorities: Object.freeze(priorities),
        blockedCells: Object.freeze([...candidate.blockedCells].sort())
      })
    });
  });

  return Object.freeze({
    installed: Object.freeze(installed),
    instances: Object.freeze(instances),
    diagnostics: Object.freeze(diagnostics)
  });
}

export class ViewPackageAssetRegistry {
  readonly #secret: Buffer;
  readonly #assets = new Map<string, ViewPackageAsset>();

  constructor(secret: Buffer = randomBytes(32)) {
    if (secret.byteLength < 32) throw new Error("View Package asset secret must contain at least 256 bits");
    this.#secret = Buffer.from(secret);
  }

  async register(input: {
    projectId: string;
    instanceId: string;
    packageRoot: string;
    file: string;
  }): Promise<ViewPackageAsset> {
    const path = await safePackageFile(input.packageRoot, resolveModulePackageFile(input.packageRoot, input.file));
    const mime = assetMime.get(extname(path).toLowerCase());
    if (!mime) throw new Error(`View Package asset type is not allowed: ${basename(path)}`);
    const digest = await fileDigest(path);
    const key = createHmac("sha256", this.#secret)
      .update(`${input.projectId}\0${input.instanceId}\0${path}\0${digest}`)
      .digest("base64url");
    const asset = Object.freeze({ key, projectId: input.projectId, instanceId: input.instanceId, path, digest, mime });
    this.#assets.set(key, asset);
    return asset;
  }

  async read(key: string, projectId: string): Promise<{ asset: ViewPackageAsset; body: Buffer } | undefined> {
    const asset = this.#assets.get(key);
    if (!asset || asset.projectId !== projectId || !safeEqual(key, asset.key)) return undefined;
    const body = await readFile(asset.path);
    if (createHash("sha256").update(body).digest("hex") !== asset.digest) return undefined;
    return { asset, body };
  }
}

export function compareViewCandidatePriority(
  left: readonly [number, number],
  right: readonly [number, number],
): number {
  return left[0] - right[0] || left[1] - right[1];
}

async function safePackageFile(root: string, candidate: string): Promise<string> {
  const packageRoot = await realpath(resolve(root));
  const path = await realpath(candidate);
  const fromRoot = relative(packageRoot, path);
  if (!fromRoot || fromRoot.startsWith("..") || resolve(packageRoot, fromRoot) !== path) {
    throw new Error(`View Package file escapes its package: ${candidate}`);
  }
  if (!(await stat(path)).isFile()) throw new Error(`View Package asset is not a file: ${candidate}`);
  return path;
}

async function fileDigest(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer);
}
