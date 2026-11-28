import { invokeCliModule } from "../helpers/cli-module.js";

const entrypoint = process.argv[2];
const cwd = process.cwd();
const env = { ...process.env };

process.on("disconnect", () => process.exit(1));
process.on("message", async (args: string[]) => {
  let result: Awaited<ReturnType<typeof invokeCliModule>>;
  try {
    result = await invokeCliModule(args, cwd, env, entrypoint);
  } catch (error) {
    const failure = (error instanceof Error ? error : new Error(String(error))) as Error & {
      stdout?: string; stderr?: string; code?: number;
    };
    process.send!({ type: "result", error: failure.message, stdout: failure.stdout, stderr: failure.stderr, code: failure.code });
    return;
  }
  process.send!({ type: "result", ...result });
});
