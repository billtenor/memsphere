import { readFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import type { RewindWorker } from "./types.js";
import { failure } from "./errors.js";
import { terminateProcessTree } from "../platform-process.js";
import { inspectWindowsReviewJob } from "./windows-review-job.js";

const exec = promisify(execFile);
export type ProcessIdentity = { pid: number; started: string; group: number };
/** A kernel start identity, distinct from a persisted ACP session or a recycled PID. */
export async function captureProcessIdentity(pid: number): Promise<ProcessIdentity | undefined> {
  if (!Number.isSafeInteger(pid) || pid < 1) throw failure("INVALID_ARGUMENT", "Invalid worker PID");
  try {
    if (process.platform === "linux") {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8"), fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (fields[0] === "Z" || fields[0] === "X") return undefined;
      const boot = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
      return { pid, group: Number(fields[2]), started: `${boot}:${fields[19]}` };
    }
    if (process.platform === "win32") {
      const [identity] = await queryWindowsProcesses(pid);
      if (!identity) return undefined;
      return windowsIdentity(identity);
    }
    const { stdout } = await exec("ps", ["-p", String(pid), "-o", "pgid=", "-o", "lstart="]);
    const match = stdout.trim().match(/^(\d+)\s+(.+)$/);
    return match ? { pid, group: Number(match[1]), started: match[2] } : undefined;
  } catch (error) {
    if (process.platform === "win32") throw error;
    if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "") || (error as { code?: unknown }).code === 1) return undefined;
    throw error;
  }
}
type WindowsProcess = { pid: number; group: number; parent: number; started: string | null };
function windowsIdentity(row: WindowsProcess): ProcessIdentity {
  if (!row.started) throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Windows process exists but its creation identity is unavailable");
  return { pid: row.pid, group: row.group, started: row.started };
}
type ProcessQuery = (script: string) => Promise<{ stdout: string }>;
/** A successful empty query proves absence; command/transport/shape failures do not. */
export async function queryWindowsProcesses(pid?: number, query: ProcessQuery = script =>
  exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 10000, maxBuffer: 8 * 1024 * 1024 })
): Promise<WindowsProcess[]> {
  if (pid !== undefined && (!Number.isSafeInteger(pid) || pid < 1)) throw failure("INVALID_ARGUMENT", "Invalid worker PID");
  const filter = pid === undefined ? "" : ` -Filter 'ProcessId=${pid}'`;
  const script = `$ErrorActionPreference='Stop'; try { $rows=@(Get-CimInstance Win32_Process${filter} -ErrorAction Stop | Select-Object ProcessId,ParentProcessId,@{Name='Started';Expression={if($_.CreationDate){$_.CreationDate.ToUniversalTime().Ticks.ToString()}else{$null}}}); ConvertTo-Json -InputObject @{ok=$true;processes=$rows} -Depth 3 -Compress } catch { [Console]::Error.WriteLine($_.ToString()); exit 2 }`;
  const { stdout } = await query(script);
  const result = JSON.parse(stdout);
  if (result?.ok !== true || !Array.isArray(result.processes)) throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Windows process query returned no success evidence");
  return result.processes.map((row: { ProcessId: unknown; ParentProcessId: unknown; Started: unknown }) => {
    if (!Number.isSafeInteger(row.ProcessId) || Number(row.ProcessId) < 0 || !Number.isSafeInteger(row.ParentProcessId) || Number(row.ParentProcessId) < 0 || (row.Started !== null && (typeof row.Started !== "string" || !/^\d+$/.test(row.Started))))
      throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Windows process query returned invalid identity evidence");
    return { pid: Number(row.ProcessId), group: Number(row.ProcessId), parent: Number(row.ParentProcessId), started: row.Started as string | null };
  });
}
const windowsProcesses = () => queryWindowsProcesses();
function windowsGroup(rows: WindowsProcess[], group: number): ProcessIdentity[] {
  const ids = new Set([group]); let more = true;
  while (more) { more = false; for (const row of rows) if (ids.has(row.parent) && !ids.has(row.pid)) { ids.add(row.pid); more = true; } }
  return rows.filter(row => ids.has(row.pid)).map(windowsIdentity);
}
export async function captureProcessGroup(group: number): Promise<ProcessIdentity[]> {
  if (process.platform === "win32") {
    return windowsGroup(await windowsProcesses(), group);
  }
  if (process.platform !== "linux") {
    const { stdout } = await exec("ps", ["-axo", "pid=,pgid=,stat=,lstart="]);
    return stdout.split("\n").flatMap(line => {
      const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
      return match && Number(match[2]) === group && !match[3].includes("Z")
        ? [{ pid: Number(match[1]), group, started: match[4].trim() }] : [];
    });
  }
  const ids = (await readdir("/proc")).filter(s => /^\d+$/.test(s)).map(Number);
  const identities = await Promise.all(ids.map(captureProcessIdentity));
  return identities.filter((p): p is ProcessIdentity => Boolean(p && p.group === group));
}
function same(a: ProcessIdentity, b: ProcessIdentity) { return a.pid === b.pid && a.started === b.started && a.group === b.group; }
export async function stopRewindWorker(worker: RewindWorker) {
  const rows = process.platform === "win32" ? await windowsProcesses() : undefined;
  const leaderRow = rows?.find(row => row.pid === worker.pid);
  const leader = rows ? leaderRow ? windowsIdentity(leaderRow) : undefined : await captureProcessIdentity(worker.pid);
  if (worker.job) {
    if (process.platform !== "win32" || !worker.identity || worker.identity.group !== worker.pid || worker.pid === process.pid) throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Windows Reviewer job identity unavailable");
    if (leader && !same(worker.identity, leader)) {
      // The saved PID may have been recycled after this attempt exited. Only
      // the immutable tracked Job can prove that the old attempt is finished;
      // never send a termination request using the replacement PID.
      if ((await inspectWindowsReviewJob(worker.job)).active === 0) return;
      throw failure("PROCESS_IDENTITY_CHANGED", "Reviewer process identity changed; no termination signal sent");
    }
    const job = await inspectWindowsReviewJob(worker.job, Boolean(leader));
    if (job.active) throw failure("PROCESS_TERMINATION_PENDING", "Reviewer job still has associated processes; rewind remains pending");
    if (!job.exists && (leader || !worker.job.includes(".Reviewer.Tracked."))) throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Reviewer job is unavailable; complete exit is not proven");
    return;
  }
  // A historical snapshot cannot exclude descendants born after it. Only the
  // enrolled kernel job proves complete Windows membership, including orphans.
  if (process.platform === "win32") {
    if (leader && worker.identity && !same(worker.identity, leader)) throw failure("PROCESS_IDENTITY_CHANGED", "Reviewer process identity changed; no termination signal sent");
    throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Reviewer has no kernel job membership evidence; rewind remains pending");
  }
  if (!worker.identity) {
    if (!leader && !(await captureProcessGroup(worker.pid)).length) return;
    throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Cannot safely identify old Reviewer; rewind is saved, retry status after resolving the worker");
  }
  const members = await captureProcessGroup(worker.identity.group);
  if (!members.length) return;
  if (leader && !same(worker.identity, leader) || !leader && members.some(p => !worker.members?.some(old => same(old, p))))
    throw failure("PROCESS_IDENTITY_CHANGED", "Reviewer process identity changed; no termination signal sent");
  if (worker.identity.group !== worker.pid || worker.pid === process.pid) throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Reviewer is not an isolated worker process group");
  await terminateProcessTree(worker.pid, "SIGTERM", process.platform, true).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  });
  for (let i = 0; i < 40; i++) {
    const survivors = await captureProcessGroup(worker.identity.group);
    if (!survivors.length) return;
    await delay(25);
  }
  throw failure("PROCESS_TERMINATION_PENDING", "Reviewer process group has not exited; rewind saved, retry run status");
}
