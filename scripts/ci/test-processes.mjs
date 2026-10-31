import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const exec = promisify(execFile);

// Snapshot only on cancellation. Browsers create their own process groups, so
// killing just the Node test wrapper or its group does not reclaim the tree.
export async function processTable() {
  if (process.platform === "win32") {
    const { stdout } = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress"],
    { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return [].concat(JSON.parse(stdout)).map(row => ({ pid: row.ProcessId, parent: row.ParentProcessId, started: JSON.stringify(row.CreationDate) }));
  }
  const { stdout } = await exec("ps", ["-axo", "pid=,ppid=,pgid=,stat=,lstart="], { maxBuffer: 8 * 1024 * 1024 });
  return stdout.trim().split("\n").filter(Boolean).map(line => {
    const [pid, parent, group, state, ...started] = line.trim().split(/\s+/);
    return { pid: Number(pid), parent: Number(parent), group: Number(group), zombie: state.startsWith("Z"), started: started.join(" ") };
  });
}

function ownedTree(table, roots) {
  const owned = new Set(roots);
  for (;;) {
    const children = table.filter(row => owned.has(row.parent) && !owned.has(row.pid));
    if (!children.length) return table.filter(row => owned.has(row.pid) && !row.zombie);
    for (const child of children) owned.add(child.pid);
  }
}

export async function terminateTestProcesses(children, signal) {
  const roots = [...children].map(child => child.pid).filter(Boolean);
  if (!roots.length) return;
  const tree = ownedTree(await processTable(), roots);
  const owned = new Set(tree.map(row => row.pid));
  // Only groups whose leaders belong to this runner are eligible.
  const groups = new Set(tree.filter(row => owned.has(row.group)).map(row => row.group));
  const send = (requested, targets = groups) => {
    for (const group of targets) {
      try { process.kill(-group, requested); }
      catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  };
  const identities = new Map(tree.map(row => [row.pid, row.started]));
  const survivors = async () => (await processTable()).filter(row => identities.get(row.pid) === row.started && owned.has(row.pid) && !row.zombie);
  let killFailure;
  if (process.platform === "win32") {
    // Windows has no POSIX signals/process groups. Snapshot first so already
    // orphaned children remain known even when taskkill removes their parent.
    if (owned.size) await exec("taskkill.exe", [...[...owned].flatMap(pid => ["/PID", String(pid)]), "/T", "/F"],
      { windowsHide: true }).catch(error => { killFailure = error; });
  } else {
    send(signal);
    const gracefulDeadline = performance.now() + 2000;
    // Non-child descendants have no ChildProcess exit event in this process.
    // Observe the OS table with a bounded cleanup grace period, never a test's
    // execution deadline. Zombies are exited processes waiting for OS reaping.
    while ((await survivors()).length && performance.now() < gracefulDeadline) await delay(50);
    const remaining = await survivors();
    if (!remaining.length) return;
    send("SIGKILL", new Set(remaining.map(row => row.group).filter(group => groups.has(group))));
  }
  const forcedDeadline = performance.now() + 5000;
  let remaining;
  do {
    remaining = await survivors();
    if (!remaining.length) return;
    await delay(50);
  } while (performance.now() < forcedDeadline);
  throw new Error(`Cancelled test processes did not exit: ${remaining.map(row => row.pid).join(", ")}`, { cause: killFailure });
}
