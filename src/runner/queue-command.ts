import { access, readFile } from "node:fs/promises";
import { extname, win32 } from "node:path";
import { resolveExecutable } from "../acp/detection.js";

/** Resolve known Node launchers without sending multiline arguments through CMD. */
export function parseWindowsNodeShim(source: string, shim: string, node = process.execPath) {
  const calls = [...source.matchAll(/(?:^|[&|]\s*)@?"([^"\r\n]+)"\s+"([^"\r\n]+\.(?:mjs|cjs|js))"\s+%\*\s*$/gim)];
  if (calls.length !== 1) return undefined;
  const [, interpreter, target] = calls[0];
  const directory = `${win32.dirname(shim)}\\`;
  const expand = (value: string) => value.replace(/%dp0%|%~dp0/gi, () => directory);
  const script = expand(target);
  if (script.includes("%") || !win32.isAbsolute(script)) return undefined;
  if (interpreter.toLowerCase() === "%_prog%") {
    if (!/set\s+"_prog=node"/i.test(source) || !/set\s+"_prog=%dp0%[\\/]node\.exe"/i.test(source)) return undefined;
    return { command: node, args: [win32.normalize(script)], adjacentNode: win32.join(win32.dirname(shim), "node.exe") };
  }
  const executable = expand(interpreter);
  if (executable.includes("%") || !win32.isAbsolute(executable) || win32.basename(executable).toLowerCase() !== "node.exe") return undefined;
  return { command: win32.normalize(executable), args: [win32.normalize(script)] };
}

export async function resolveQueueCommand(command: string) {
  if (process.platform !== "win32") return { command, args: [] as string[] };
  const executable = await resolveExecutable(command, process.env.PATH);
  if (!executable || !/\.(?:cmd|bat)$/i.test(extname(executable))) return { command, args: [] as string[] };
  const launch = parseWindowsNodeShim(await readFile(executable, "utf8"), executable);
  if (!launch) throw new Error(`QUEUE_BATCH_UNSUPPORTED: use a native executable or a standard Node CLI shim: ${executable}`);
  await access(launch.args[0]);
  if (launch.adjacentNode && await access(launch.adjacentNode).then(() => true, () => false)) launch.command = launch.adjacentNode;
  return { command: launch.command, args: launch.args };
}
