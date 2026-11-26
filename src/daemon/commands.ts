import { failure } from "../context_control/errors.js";
import { Command } from "commander";
import { ensureDaemon, ensureClaudeNotificationDaemon, daemonStatus, stopDaemon, runDaemon, daemonControl } from "./service.js";
import { detectRunnerAgents, detectIdentity, currentIdentity, readRunnerAgents } from "../runner/identity.js";
import { listTasks, retryFailedTask } from "./tasks.js";
import { readConfig } from "../config.js";
import { inspectReview } from "./review.js";
import { prepareClaudeReviewRecipient } from "./claude-review-callback.js";
import { readArtifactReviewForRunner } from "../context_control/review-repository.js";
import { registerResultAction, addCliOutput, cliCommand, savedResult, commandFacts, paginateCliItems, previewText } from "../commands/output.js";
import { daemonStatusSchema, publicDaemonStatus } from "./public-status.js";
import { z } from "zod";
import { nextAction } from "../prompts/cli-output.js";

const runnerSchema = z.object({ identified: z.boolean(), agentType: z.enum(["codex", "traex", "claude"]).optional() }).strict();
const runnerListSchema = z.object({ items: z.array(z.object({
  type: z.string(), status: z.enum(["installed", "version_unknown", "missing", "failed"]), version: z.string().optional()
}).strict()) }).strict();
const taskSchema = z.object({
  id: z.string(), roundId: z.string(), currentRound: z.boolean(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  stage: z.enum(["wait", "render", "send", "cancel", "recovery"]).optional()
}).strict();
const taskListSchema = z.object({
  items: z.array(taskSchema), total: z.number().int().nonnegative(), nextCursor: z.string().optional()
}).strict();
const retrySchema = z.object({ taskId: z.string(), roundId: z.string(), status: z.string(), mayRepeatNotification: z.boolean(), nextAction }).strict();

async function showDaemon(command: string) {
  const status = await daemonStatus();
  return commandFacts(() => daemonStatusSchema.parse(publicDaemonStatus(status)), { saved: command === "daemon status" ? undefined : savedResult("daemon", ["daemon", "status"]) });
}

export function registerDaemonCommands(program: Command) {
  const daemon = program.command("daemon").description("Manage the Home daemon, View and asynchronous tasks.");
  registerResultAction(addCliOutput(daemon.command("start")), async () => { await ensureDaemon(); return showDaemon("daemon start"); });
  registerResultAction(addCliOutput(daemon.command("status")), () => showDaemon("daemon status"));
  registerResultAction(addCliOutput(daemon.command("stop")), async () => { await stopDaemon(); return showDaemon("daemon stop"); });
  registerResultAction(addCliOutput(daemon.command("restart")), async () => { await stopDaemon(); await ensureDaemon(); return showDaemon("daemon restart"); });
  daemon.command("serve", { hidden: true }).action(async () => { await runDaemon(); });
  const runner = program.command("runner").description("Inspect installed Runner Agents and the calling session.");
  registerResultAction(addCliOutput(runner.command("detect")), async () => {
    const items = (await detectRunnerAgents()).map(({ type, status, version }) => ({
      type, status, ...(version ? { version: previewText(version, 160).text } : {})
    }));
    return commandFacts(() => runnerListSchema.parse({ items }));
  });
  registerResultAction(addCliOutput(runner.command("identity")), () => {
    const identity = detectIdentity();
    return commandFacts(() => runnerSchema.parse({ identified: Boolean(identity), agentType: identity?.agentType }));
  });
}

export function registerWaitTaskCommands(wait: Command) {
  registerResultAction(addCliOutput(wait.command("status").option("--limit <n>", "Page size, 1–100; default 20")
    .option("--cursor <token>")), async (_options, command: Command) => {
    const options = command.optsWithGlobals();
    if (!options.review) throw new Error("--review <id> is required");
    const config = await readConfig();
    const identity = await currentIdentity(true);
    const tasks = (await listTasks()).filter(r => r.value.input.project === config.project!.name && r.value.input.reviewId === options.review && r.value.recipient.agentType === identity!.agentType && r.value.recipient.sessionId === identity!.sessionId);
    const context = await readArtifactReviewForRunner({ runsRoot: config.runsRoot, reviewId: options.review });
    const items = tasks.map(({ value }) => ({
      id: value.id, roundId: value.input.roundId, currentRound: value.input.roundId === context.round.id,
      status: value.status, stage: value.error?.stage
    })).sort((a, b) => Number(b.currentRound) - Number(a.currentRound) || a.id.localeCompare(b.id));
    const page = paginateCliItems(items, options, {
      command: "run.review.wait.status",
      scope: { project: config.project!.name, reviewId: options.review, identity },
      filters: { currentRoundId: context.round.id }
    }, "summary");
    return commandFacts(() => taskListSchema.parse({
      items: page.items, total: items.length, nextCursor: page.nextCursor
    }));
  });
  registerResultAction(addCliOutput(wait.command("retry").requiredOption("--round <id>")), async (_options, command: Command) => {
    const options = command.optsWithGlobals();
    if (!options.review) throw new Error("--review <id> is required");
    const config = await readConfig();
    const identity = (await currentIdentity(true))!;
    const context = await inspectReview(config, options.review);
    if (context.round.id !== options.round) throw new Error("Cannot retry an obsolete Review round");
    const row = (await listTasks()).filter(r => r.value.input.project === config.project!.name && r.value.input.reviewId === options.review && r.value.input.roundId === options.round && r.value.recipient.agentType === identity.agentType && r.value.recipient.sessionId === identity.sessionId)
      .sort((a, b) => b.value.createdAt.localeCompare(a.value.createdAt))[0];
    if (!row || row.value.status !== "failed") throw new Error("Only a failed task for the current session can be retried");
    let claudeRecipient;
    if (identity.agentType === "claude") {
      if (!(await readRunnerAgents()).claude?.async_enabled) throw failure("UNSUPPORTED_CAPABILITY", "Claude Code asynchronous execution is disabled");
      claudeRecipient = await prepareClaudeReviewRecipient(identity.sessionId, row.value.input);
      await ensureClaudeNotificationDaemon();
    } else {
      await ensureDaemon();
    }
    const task = await retryFailedTask(row.id, undefined, claudeRecipient);
    await daemonControl("notify");
    const resume = cliCommand(["--project", config.project!.name, "run", "review", "wait", "--review", options.review]);
    return commandFacts(() => retrySchema.parse({
      taskId: task.id, roundId: task.input.roundId, status: task.status,
      mayRepeatNotification: true, nextAction: { kind: "wait", resume }
    }), { saved: { id: task.id, inspect: cliCommand([...resume.args, "status"]) } });
  });
}
