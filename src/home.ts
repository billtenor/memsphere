import { homedir } from "node:os";
import { resolve } from "node:path";

export type HomeEnvironment = NodeJS.ProcessEnv;

export function resolveMemsphereHome(options: {
  env?: HomeEnvironment;
  platform?: NodeJS.Platform;
  userHome?: string;
} = {}): string {
  const env = options.env ?? process.env;
  const override = env.MEMSPHERE_HOME?.trim();
  if (override) return resolve(override);

  const platform = options.platform ?? process.platform;
  const userHome = options.userHome ?? homedir();
  if (platform === "darwin") return resolve(userHome, "Library", "Application Support", "memsphere");
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim();
    if (!localAppData) throw new Error("LOCALAPPDATA is required to resolve Memsphere Home on Windows");
    return resolve(localAppData, "memsphere");
  }

  const xdgDataHome = env.XDG_DATA_HOME?.trim();
  return resolve(xdgDataHome || resolve(userHome, ".local", "share"), "memsphere");
}

export function homePaths(home = resolveMemsphereHome()) {
  return {
    home,
    configPath: resolve(home, "config.json"),
    registryPath: resolve(home, "registry.json"),
    projectsRoot: resolve(home, "projects"),
    runtimeRoot: resolve(home, ".runtime")
  };
}
