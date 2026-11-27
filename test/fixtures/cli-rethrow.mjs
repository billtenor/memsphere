import { createCliProgram } from "../../dist/cli-program.js";
import { parseCli } from "../../dist/commands/cli-errors.js";
import { unpackCliArgv } from "../../dist/prompts/cli-command.js";

const [entrypoint, ...args] = process.argv.slice(2);
// Keep the real executable path for daemon and Reviewer launches.
process.argv = [process.execPath, entrypoint, ...args];
await parseCli(createCliProgram(), unpackCliArgv(process.argv), { rethrow: true });
