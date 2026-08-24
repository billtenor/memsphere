import crossSpawn from "cross-spawn";
import type { ChildProcess, SpawnOptions } from "node:child_process";

export function spawnCommand(
  command: string,
  args: readonly string[],
  options: SpawnOptions
): ChildProcess {
  return crossSpawn(command, [...args], {
    ...options,
    windowsHide: options.windowsHide ?? process.platform === "win32"
  });
}

export async function terminateProcessTree(
  pid: number,
  signal: NodeJS.Signals = "SIGTERM",
  platform: NodeJS.Platform = process.platform,
  processGroup = false
): Promise<void> {
  if (platform !== "win32") {
    process.kill(processGroup ? -pid : pid, signal);
    return;
  }
  await new Promise<void>((resolveTermination, reject) => {
    const child = spawnCommand("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0 || code === 128) resolveTermination();
      else reject(new Error(`taskkill failed for PID ${pid} with code ${code}: ${stderr.trim()}`));
    });
  });
}
