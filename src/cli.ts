#!/usr/bin/env node
import { runCli } from "./cli-program.js";
import { unpackCliArgv } from "./prompts/cli-command.js";

await runCli(unpackCliArgv(process.argv));
