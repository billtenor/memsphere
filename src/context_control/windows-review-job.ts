import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { failure } from "./errors.js";
import type { ProcessIdentity } from "./review-process.js";

// A snapshot cannot prove that a descendant did not spawn another process and
// exit between probes. Job membership is maintained by the Windows kernel,
// including children born after the worker/provider exit. Breakaway is disabled.
// Global names remain addressable when Runner resumes in another Windows session.
// The keeper retains the named handle until the kernel reports zero members.
// Its pipes belong to a detached host, not to the Reviewer being tracked.
// KILL_ON_JOB_CLOSE makes unexpected keeper loss terminate the entire job.
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
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref Extended data, uint size);
 [StructLayout(LayoutKind.Sequential)] struct Accounting { public long User, Kernel, PeriodUser, PeriodKernel; public uint Faults, Total, Active, Terminated; }
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security, string name);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenJobObject(uint access, bool inherit, string name);
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
const validName = (name: string) => /^Global\\Memsphere\.Reviewer\.Tracked\.[0-9a-f-]{36}$/.test(name);
// PowerShell keeps its own stdout/stderr pipes for its whole lifetime. Only
// the ready/error message crosses the worker IPC channel; disconnecting that
// channel must neither close PowerShell's pipes nor end the host.
const keeperHost = `
const {spawn}=require('node:child_process');
process.on('disconnect',()=>{});
const child=spawn('powershell.exe',JSON.parse(process.argv[1]),{windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='',errors='';
child.stdout.on('data',data=>{output+=data;if(output.includes('{"ready":true}')&&process.connected)process.send({ready:true});});
child.stderr.on('data',data=>{errors=(errors+data).slice(-4000);});
child.once('error',error=>{if(process.connected)process.send({error:error.message});process.exitCode=1;});
child.once('close',code=>{if(process.connected)process.send({error:errors||'Job keeper exited before ready: '+code});process.exitCode=code??1;});
`;

/** Enroll before claim and before ANY provider preparation can spawn children. */
export async function startWindowsReviewJob(identity: ProcessIdentity): Promise<string> {
  const name = `Global\\Memsphere.Reviewer.Tracked.${randomUUID()}`;
  if (!/^\d+$/.test(identity.started)) throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Invalid Windows worker creation identity");
  const host = spawn(process.execPath, ["-e", keeperHost, JSON.stringify(encoded(`[ReviewerJob]::Keep('${name}', ${identity.pid}, '${identity.started}')`))], {detached:true,windowsHide:true,stdio:["ignore","ignore","ignore","ipc"]});
  await new Promise<void>((resolve,reject)=>{
    const timer=setTimeout(()=>fail(new Error("Windows Reviewer job enrollment timed out")),15000);
    const done=()=>{clearTimeout(timer);host.off("error",fail);host.off("exit",exited);host.off("message",message);};
    const fail=(error:Error)=>{done();host.kill();reject(failure("PROCESS_IDENTITY_UNAVAILABLE",error.message));};
    const exited=(code:number|null)=>fail(new Error(`Windows Reviewer job host exited before enrollment: ${code}`));
    const message=(value:unknown)=>{const result=value as {ready?:boolean;error?:string};if(result.ready===true){done();resolve();}else if(result.error)fail(new Error(result.error));};
    host.once("error",fail);host.once("exit",exited);host.on("message",message);
  });
  host.disconnect();host.unref();
  return name;
}

/** Only Tracked jobs guarantee kill-on-close and complete kernel membership. */
export async function inspectWindowsReviewJob(name: string, terminate = false): Promise<{ exists: boolean; active: number }> {
  if (!validName(name)) throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Invalid Windows Reviewer job identity");
  const { stdout } = await promisify(execFile)("powershell.exe", encoded(`[ReviewerJob]::Inspect('${name}', $${terminate})`), { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
  const result = JSON.parse(stdout);
  if (typeof result?.exists !== "boolean" || !Number.isSafeInteger(result.active) || result.active < 0 || !result.exists && result.active !== 0)
    throw failure("PROCESS_IDENTITY_UNAVAILABLE", "Invalid Windows Reviewer job result");
  return result;
}
