import { Command } from "commander";
import { ensureDaemon, daemonStatus, stopDaemon, runDaemon, daemonControl } from "./service.js";
import { detectRunnerAgents, detectIdentity, currentIdentity } from "../runner/identity.js";
import { listTasks, retryFailedTask } from "./tasks.js";
import { readConfig } from "../config.js";
import { inspectReview } from "./review.js";

export function registerDaemonCommands(program: Command) {
  const daemon = program.command("daemon").description("Manage the Home daemon, View and asynchronous tasks.");
  daemon.command("start").action(async () => { await ensureDaemon(); console.log(JSON.stringify(await daemonStatus())); });
  daemon.command("status").action(async () => { console.log(JSON.stringify(await daemonStatus())); });
  daemon.command("stop").action(async () => { await stopDaemon(); console.log("Daemon stopped; View intent and tasks retained."); });
  daemon.command("restart").action(async () => { await stopDaemon(); await ensureDaemon(); console.log(JSON.stringify(await daemonStatus())); });
  daemon.command("serve", { hidden: true }).action(async () => { await runDaemon(); });
  const runner = program.command("runner").description("Inspect installed Runner Agents and the calling session.");
  runner.command("detect").action(async () => { console.log(JSON.stringify(await detectRunnerAgents(), null, 2)); });
  runner.command("identity").action(() => { console.log(JSON.stringify(detectIdentity() ?? null)); });
}

export function registerWaitTaskCommands(wait: Command) {
  wait.command("status").action(async (_options, command: Command) => {
    const options = command.optsWithGlobals();
    if (!options.review) throw new Error("--review <id> is required");
    const config = await readConfig();
    const identity = await currentIdentity(true);
    const tasks = (await listTasks()).filter(r => r.value.input.project === config.project!.name && r.value.input.reviewId === options.review && r.value.recipient.agentType === identity!.agentType && r.value.recipient.sessionId === identity!.sessionId);
    const context = await inspectReview(config, options.review);
    console.log(JSON.stringify(tasks.map(r => ({ ...r.value, currentRound: r.value.input.roundId === context.round.id })), null, 2));
  });
  wait.command("retry").requiredOption("--round <id>").action(async (_options, command: Command) => {
    const options = command.optsWithGlobals();
    if (!options.review) throw new Error("--review <id> is required");
    const config = await readConfig();
    const identity = (await currentIdentity(true))!;
    const context = await inspectReview(config, options.review);
    if (context.round.id !== options.round) throw new Error("Cannot retry an obsolete Review round");
    const row = (await listTasks()).filter(r => r.value.input.project === config.project!.name && r.value.input.reviewId === options.review && r.value.input.roundId === options.round && r.value.recipient.agentType === identity.agentType && r.value.recipient.sessionId === identity.sessionId)
      .sort((a, b) => b.value.createdAt.localeCompare(a.value.createdAt))[0];
    if (!row || row.value.status !== "failed") throw new Error("Only a failed task for the current session can be retried");
    await ensureDaemon();
    const task = await retryFailedTask(row.id);
    await daemonControl("notify");
    console.log(`Task ${task.id} registered for retry; a previous notification may already have been delivered.`);
  });
}
