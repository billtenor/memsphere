param([int]$TargetPid, [string]$ExpectedTicks)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
public static class FixtureHandle {
 [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint rights, bool inherit, int pid);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr h, out long created, out long exited, out long kernel, out long user);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr h, uint code);
 [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h, uint ms);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
 public static void Control(int pid, string expected) {
  long ticks;
  if (pid <= 0 || !long.TryParse(expected, out ticks) || ticks <= 0) throw new Exception("Invalid expected identity");
  IntPtr h = OpenProcess(0x100001u | 0x1000u, false, pid);
  if (h == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
  try {
   long created, exited, kernel, user;
   if (!GetProcessTimes(h, out created, out exited, out kernel, out user)) throw new Win32Exception(Marshal.GetLastWin32Error());
   // FILETIME starts in 1601; CIM uses DateTime ticks since year 1.
   long actual = DateTime.FromFileTimeUtc(created).Ticks;
   if (actual / 10 != ticks / 10) throw new Exception("Process identity changed; no termination requested");
   if (WaitForSingleObject(h, 0) != 258) throw new Exception("Expected live process before arming");
   Console.WriteLine("{\"armed\":true,\"started\":\"" + actual + "\"}"); Console.Out.Flush();
   var input = Task.Factory.StartNew(() => Console.ReadLine());
   if (!input.Wait(90000)) throw new Exception("Fixture control deadline exceeded");
   string command = input.Result;
   if (command == null) throw new Exception("Control channel closed before command");
   if (command == "close") return;
   if (command != "terminate") throw new Exception("Invalid fixture control command");
   if (WaitForSingleObject(h, 0) == 258 && !TerminateProcess(h, 1)) throw new Win32Exception(Marshal.GetLastWin32Error());
   if (WaitForSingleObject(h, 10000) != 0) throw new Exception("Original process has not exited");
   Console.WriteLine("{\"terminated\":true}"); Console.Out.Flush();
  } finally { CloseHandle(h); }
 }
}
'@
  [FixtureHandle]::Control($TargetPid, $ExpectedTicks)
} catch {
  [Console]::Error.WriteLine($_.ToString())
  exit 2
}
