import { failure } from "../context_control/errors.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { resolveMemsphereHome } from "../home.js";
import { validateFilename } from "../data/extensions/shared/filesystem.js";
import { detectAcpProviderInstance } from "../acp/detection.js";
import { requireAcpProviderDefinition, defaultAcpProviderInstance } from "../acp/catalog.js";
import { spawnCommand } from "../platform-process.js";
import { resolveQueueCommand } from "./queue-command.js";
import { agentTypes, runnerSessionVariables, type AgentType } from "./agent-types.js";
import { supportsClaudeNotifications } from "./claude-notifications.js";

export { agentTypes, type AgentType } from "./agent-types.js";
const settings = z.object({ identity_enabled: z.boolean().default(false), async_enabled: z.boolean().default(false) }).strict()
  .refine(v => !v.async_enabled || v.identity_enabled, "Asynchronous execution requires Agent identity");
export const runnerAgentsSchema = z.object({ codex: settings.optional(), traex: settings.optional(), claude: settings.optional() }).strict();
export type RunnerAgents = z.infer<typeof runnerAgentsSchema>;
export type AgentIdentity = { agentType: AgentType; sessionId: string; id: string };

export function detectIdentity(env: NodeJS.ProcessEnv = process.env): AgentIdentity | undefined {
  const found = agentTypes.filter(type => env[runnerSessionVariables[type]]?.trim());
  if (found.length > 1) throw new Error("AGENT_IDENTITY_CONFLICT: multiple current Agent sessions are present");
  if (!found.length) return undefined;
  const agentType = found[0], sessionId = env[runnerSessionVariables[agentType]]!;
  if (sessionId !== sessionId.trim()) throw new Error("INVALID_SESSION_ID: surrounding whitespace");
  const id = `${agentType}-${sessionId}`;
  validateFilename(sessionId);
  validateFilename(`${id}.json`);
  return { agentType, sessionId, id };
}

export async function readRunnerAgents(home = resolveMemsphereHome()): Promise<RunnerAgents> {
  try {
    const config = JSON.parse(await readFile(join(home, "config.json"), "utf8"));
    return runnerAgentsSchema.parse(config.runner_agents ?? {});
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function currentIdentity(required = false, home?: string): Promise<AgentIdentity | undefined> {
  let identity: AgentIdentity | undefined;
  try { identity = detectIdentity(); }
  catch (error) {
    if (required) throw error;
    return undefined;
  }
  const config = await readRunnerAgents(home);
  if (identity && config[identity.agentType]?.identity_enabled) return identity;
  if (required) throw failure("AGENT_SESSION_REQUIRED", "AGENT_SESSION_REQUIRED: enable Runner identity and invoke Continue from a recognized Agent session");
  return undefined;
}

export async function detectRunnerAgent(type: AgentType) {
  const definition = requireAcpProviderDefinition(type);
  const result = await detectAcpProviderInstance(type, { ...defaultAcpProviderInstance(type), command: type }, {
    ...definition,
    ...(type === "claude" ? { installHelp: "Install and authenticate the Claude Code CLI." } : {})
  });
  return { ...result, asyncSupported: type === "claude"
    ? supportsClaudeNotifications(result.version)
    : result.status === "installed" };
}

export async function detectRunnerAgents() {
  return Promise.all(agentTypes.map(detectRunnerAgent));
}

export async function checkQueueCapability(command: string): Promise<void> {
  const launch = await resolveQueueCommand(command);
  return new Promise((resolve, reject) => {
    const child = spawnCommand(launch.command, [...launch.args, "queue", "--help"], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("queue capability probe timed out")); }, 3000);
    child.stdout?.on("data", chunk => { output = (output + chunk.toString()).slice(0, 65536); });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => { clearTimeout(timer); if (code === 0 && output.includes("--thread") && output.includes("--message")) resolve(); else reject(new Error("queue does not support --thread/--message; disable asynchronous execution in settings")); });
  });
}
