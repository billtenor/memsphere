import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { failure } from "./errors.js";
import type { ProcessIdentity } from "./review-process.js";

// A snapshot cannot prove that a descendant did not spawn another process and
// exit between probes. Job membership is maintained by the Windows kernel,
// including children born after the worker/provider exit. Breakaway is disabled.
// Global names remain addressable when Runner resumes in another Windows session.
// The keeper starts BEFORE the worker is enrolled, so it is outside this job.
// It closes the job only after ActiveProcesses reaches zero; unexpected keeper
// exit closes its handle with KILL_ON_JOB_CLOSE. No helper remains after the job.
const native = String.raw`
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
public static class ReviewerJob {
 [StructLayout(LayoutKind.Sequential)] struct Limits { public long User, Job; public uint Flags; public UIntPtr Min, Max; public uint Count; public UIntPtr Affinity; public uint Priority, Scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct IO { public ulong Read, Write, Other, ReadBytes, WriteBytes, OtherBytes; }
 [StructLayout(LayoutKind.Sequential)] struct Extended { public Limits Basic; public IO Io; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob; }
 [StructLayout(LayoutKind.Sequential)] struct Accounting { public long User, Kernel, PeriodUser, PeriodKernel; public uint Faults, Total, Active, Terminated; }
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security, string name);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenJobObject(uint access, bool inherit, string name);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref Extended data, uint size);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out Accounting data, uint size, IntPtr returned);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
 static uint Active(IntPtr job) { Accounting a; Check(QueryInformationJobObject(job, 1, out a, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero)); return a.Active; }
 public static void Keep(string name, int pid, string started) {
  using (Process worker = Process.GetProcessById(pid)) {
   // CIM_DATETIME records microseconds; GetProcessTimes/.NET also retains the final 100ns digit.
   long actual = worker.StartTime.ToUniversalTime().Ticks;
   if (actual / 10 != long.Parse(started) / 10) throw new Exception("Worker identity changed: expected " + started + ", observed " + actual);
   IntPtr job = CreateJobObject(IntPtr.Zero, name); int error = Marshal.GetLastWin32Error();
   if (job == IntPtr.Zero) throw new Win32Exception(error);
   try {
    if (error == 183) throw new Exception("Job name already exists");
    Extended limits = new Extended(); limits.Basic.Flags = 0x2000;
    Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(Extended))));
    Check(AssignProcessToJobObject(job, worker.Handle));
    Console.WriteLine("{\"ready\":true}"); Console.Out.Flush();
    while (Active(job) != 0) Thread.Sleep(100);
   } finally { CloseHandle(job); }
  }
 }
 public static string Inspect(string name, bool terminate) {
  IntPtr job = OpenJobObject(terminate ? 12u : 4u, false, name);
  if (job == IntPtr.Zero) {
   int error = Marshal.GetLastWin32Error();
   if (error == 2) return "{\"exists\":false,\"active\":0}";
   throw new Win32Exception(error);
  }
  try {
   if (terminate) Check(TerminateJobObject(job, 1));
   uint active = Active(job);
   if (terminate) {
    Stopwatch clock = Stopwatch.StartNew();
    while (active != 0 && clock.ElapsedMilliseconds < 5000) { Thread.Sleep(50); active = Active(job); }
   }
   return "{\"exists\":true,\"active\":" + active + "}";
  } finally { CloseHandle(job); }
 }
}
`;
// Keep PowerShell's command a single line even though the native source is multiline.
// stdin is closed for the detached worker; no interactive/here-string parsing is used.
const encoded = (body: string) => ["-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop'; try { Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(native).toString("base64")}'))); ${body} } catch { [Console]::Error.WriteLine($_.ToString()); exit 2 }`];
const validName = (name: string) => /^Global\\Memsphere\.Reviewer\.[0-9a-f-]{36}$/.test(name);
// libuv kills non-detached children when their parent exits on Windows. Keep
// PowerShell outside the worker's libuv job using a detached Node host, while
// preserving PowerShell's normal (non-detached) pipe/command execution. The
// host stays alive until Keep returns; killing it also closes the native job.
const keeperHost = `
const {spawn}=require('node:child_process');
const child=spawn('powershell.exe',JSON.parse(process.argv[1]),{windowsHide:true,stdio:['ignore','inherit','inherit']});
child.once('error',error=>{console.error(error);process.exitCode=1;});
child.once('exit',code=>{process.exitCode=code??1;});
`;

/** Enroll before claim and before ANY provider preparation can spawn children. */
export async function startWindowsReviewJob(identity: ProcessIdentity): Promise<string> {
  const name = `Global\\Memsphere.Reviewer.${randomUUID()}`;
  if (!/^\d+$/.test(identity.started)) throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Invalid Windows worker creation identity");
  const child = spawn(process.execPath, ["-e", keeperHost, JSON.stringify(encoded(`[ReviewerJob]::Keep('${name}', ${identity.pid}, '${identity.started}')`))], {
    detached: true, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise<void>((resolve, reject) => {
    let output = "", errors = "";
    const timer = setTimeout(() => { child.kill(); reject(failure("PROCESS_IDENTITY_UNAVAILABLE", "Windows Reviewer job enrollment timed out")); }, 15000);
    const done = () => { clearTimeout(timer); child.removeListener("error", failed); child.removeListener("close", exited); };
    const failed = (error: Error) => { done(); reject(error); };
    const exited = (code: number | null, signal: NodeJS.Signals | null) => failed(failure("PROCESS_IDENTITY_UNAVAILABLE", `Windows Reviewer job enrollment failed (${code ?? signal}): ${errors.slice(-2000)}; output=${JSON.stringify(output.slice(-2000))}`));
    child.once("error", failed); child.once("close", exited);
    child.stderr.on("data", data => { errors = (errors + data).slice(-4000); });
    child.stdout.on("data", data => {
      output += data;
      if (output.includes('{"ready":true}')) { done(); resolve(); }
    });
  });
  child.stdout.destroy(); child.stderr.destroy(); child.unref();
  return name;
}

/** Missing named job is evidence only for attempts enrolled before claim. */
export async function inspectWindowsReviewJob(name: string, terminate = false): Promise<{ exists: boolean; active: number }> {
  if (!validName(name)) throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Invalid Windows Reviewer job identity");
  const { stdout } = await promisify(execFile)("powershell.exe", encoded(`[ReviewerJob]::Inspect('${name}', $${terminate})`), { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
  const result = JSON.parse(stdout);
  if (typeof result?.exists !== "boolean" || !Number.isSafeInteger(result.active) || result.active < 0 || !result.exists && result.active !== 0)
    throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Invalid Windows Reviewer job result");
  return result;
}
