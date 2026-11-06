import { AsyncLocalStorage } from "node:async_hooks";
import { runCli } from "../../src/cli-program.js";

const outputScope = new AsyncLocalStorage<symbol>();

/** Run the real command tree/handlers within this test process. Tests that need
 * OS process or shell boundaries must continue to use their subprocess helper.
 * Call serially: environment and standard streams belong to the process.
 */
export async function invokeCliModule(args: string[], cwd: string, env: NodeJS.ProcessEnv, entrypoint: string) {
  const previous = { cwd: process.cwd(), env: { ...process.env }, argv: process.argv, exitCode: process.exitCode,
    stdout: process.stdout.write, stderr: process.stderr.write };
  const output: Buffer[] = [], errors: Buffer[] = [];
  const token = Symbol("CLI output");
  const capture = (chunks: Buffer[], target: NodeJS.WriteStream, forward: typeof process.stdout.write) => ((...args: Parameters<typeof process.stdout.write>) => {
    // node:test also writes its result protocol through these streams. Its
    // asynchronous events belong to a different scope and must reach the runner.
    if (outputScope.getStore() !== token) return Reflect.apply(forward, target, args);
    const [chunk, encoding, callback] = args;
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk, typeof encoding === "string" ? encoding : undefined) : Buffer.from(chunk));
    (typeof encoding === "function" ? encoding : callback)?.();
    return true;
  }) as typeof process.stdout.write;
  try {
    process.chdir(cwd);
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    process.argv = [process.execPath, entrypoint, ...args];
    process.exitCode = 0;
    process.stdout.write = capture(output, process.stdout, previous.stdout); process.stderr.write = capture(errors, process.stderr, previous.stderr);
    await outputScope.run(token, () => runCli(process.argv));
    const result = { stdout: Buffer.concat(output).toString(), stderr: Buffer.concat(errors).toString() };
    if (process.exitCode) throw Object.assign(new Error(result.stderr || `CLI exited ${process.exitCode}`), result, { code: process.exitCode });
    return result;
  } finally {
    process.stdout.write = previous.stdout; process.stderr.write = previous.stderr;
    process.exitCode = previous.exitCode; process.argv = previous.argv;
    for (const key of Object.keys(process.env)) if (!(key in previous.env)) delete process.env[key];
    Object.assign(process.env, previous.env); process.chdir(previous.cwd);
  }
}
