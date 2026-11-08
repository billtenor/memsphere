import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

const exec = promisify(execFile);
const commandTimeoutMs = 10000;
async function processCommand(file, args, options = {}) {
  try {
    return await exec(file, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024,
      timeout: commandTimeoutMs, signal: options.signal });
  } catch (error) {
    const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
    const message = `${error.message}${stderr && !error.message.includes(stderr) ? `\nstderr: ${stderr}` : ""}`;
    throw new Error(`Process command ${file} failed (timeoutMs=${commandTimeoutMs}, code=${String(error.code)}, signal=${String(error.signal)}, killed=${String(error.killed)}): ${message}`, { cause: error });
  }
}

// Snapshot only on cancellation. Browsers create their own process groups, so
// killing just the Node test wrapper or its group does not reclaim the tree.
export async function processTable(options = {}) {
  if (process.platform === "win32") {
    const { stdout } = await processCommand("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate | ConvertTo-Json -Compress"], options);
    return [].concat(JSON.parse(stdout)).map(row => ({ pid: row.ProcessId, parent: row.ParentProcessId, started: JSON.stringify(row.CreationDate) }));
  }
  const { stdout } = await processCommand("ps", ["-axo", "pid=,ppid=,pgid=,stat=,lstart="], options);
  return stdout.trim().split("\n").filter(Boolean).map(line => {
    const [pid, parent, group, state, ...started] = line.trim().split(/\s+/);
    return { pid: Number(pid), parent: Number(parent), group: Number(group), zombie: state.startsWith("Z"), started: started.join(" ") };
  });
}

function ownedTree(table, roots) {
  const owned = new Set(roots);
  for (;;) {
    const children = table.filter(row => (owned.has(row.parent) || owned.has(row.group)) && !owned.has(row.pid));
    if (!children.length) return table.filter(row => owned.has(row.pid) && !row.zombie);
    for (const child of children) owned.add(child.pid);
  }
}

// Darwin can return EPERM for a group containing only exited/zombie members.
// Recheck the recorded identities rather than suppressing permission failures.
export async function signalRecordedGroup(group, signal, survivors, kill = (pid, requested) => process.kill(pid, requested)) {
  try { kill(-group, signal); }
  catch (error) {
    if (error.code === "ESRCH") return;
    if (error.code === "EPERM" && !(await survivors()).some(row => row.group === group)) return;
    throw error;
  }
}

export async function terminateTestProcesses(children, signal, options = {}) {
  const roots = [...children].map(child => child.pid).filter(Boolean);
  if (!roots.length) return;
  const tree = ownedTree(await processTable(options), roots);
  const owned = new Set([...roots, ...tree.map(row => row.pid)]);
  // A recorded group leader can already have exited while its children live.
  // Only groups led by recorded roots or their descendants are eligible.
  const groups = new Set(tree.filter(row => owned.has(row.group)).map(row => row.group));
  const identities = new Map(tree.map(row => [row.pid, row.started]));
  const survivors = async () => (await processTable(options)).filter(row => identities.get(row.pid) === row.started && owned.has(row.pid) && !row.zombie);
  const send = async (requested, targets = groups) => {
    for (const group of targets) await signalRecordedGroup(group, requested, survivors);
  };
  let killFailure;
  if (process.platform === "win32") {
    // Windows has no POSIX signals/process groups. Snapshot first so already
    // orphaned children remain known even when taskkill removes their parent.
    if (owned.size) await processCommand("taskkill.exe", [...[...owned].flatMap(pid => ["/PID", String(pid)]), "/T", "/F"], options).catch(error => { killFailure = error; });
  } else {
    await send(signal);
    const gracefulDeadline = performance.now() + 2000;
    // Non-child descendants have no ChildProcess exit event in this process.
    // Observe the OS table with a bounded cleanup grace period, never a test's
    // execution deadline. Zombies are exited processes waiting for OS reaping.
    while ((await survivors()).length && performance.now() < gracefulDeadline) await delay(50, undefined, options);
    const remaining = await survivors();
    if (!remaining.length) return;
    await send("SIGKILL", new Set(remaining.map(row => row.group).filter(group => groups.has(group))));
  }
  const forcedDeadline = performance.now() + 5000;
  let remaining;
  do {
    remaining = await survivors();
    if (!remaining.length) return;
    await delay(50, undefined, options);
  } while (performance.now() < forcedDeadline);
  throw new Error(`Cancelled test processes did not exit: ${remaining.map(row => row.pid).join(", ")}`, { cause: killFailure });
}
