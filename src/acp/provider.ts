import { isAbsolute, relative, resolve } from "node:path";
import type { ControlPlaneActor } from "../control-plane/index.js";

type AgentActor = Extract<ControlPlaneActor, { kind: "agent" }>;

export type AgentReviewProviderLaunch = {
  provider: string;
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  startupTimeoutMs: number;
  idleTimeoutMs: number;
  maxRuntimeMs: number | null;
  promptVersion: string;
  model?: string;
};

export type AgentReviewProvider = {
  id: string;
  buildLaunch(input: {
    actor: AgentActor;
    workspaceRoot: string;
    sessionEnv: Record<string, string>;
  }): AgentReviewProviderLaunch;
};

const providers = new Map<string, AgentReviewProvider>();

export function registerAgentReviewProvider(provider: AgentReviewProvider): void {
  if (providers.has(provider.id)) throw new Error(`Agent Review Provider is already registered: ${provider.id}`);
  providers.set(provider.id, provider);
}

export function getAgentReviewProvider(id: string | undefined): AgentReviewProvider {
  if (!id) throw new Error("agent_provider_missing: Agent Actor must configure agent.provider");
  const provider = providers.get(id);
  if (!provider) throw new Error(`agent_provider_unsupported: ${id}`);
  return provider;
}

function commonLaunch(
  provider: string,
  input: Parameters<AgentReviewProvider["buildLaunch"]>[0],
  args: string[],
  providerEnv: Record<string, string>
): AgentReviewProviderLaunch {
  const agent = input.actor.agent;
  const cwd = agent.cwd ? resolve(input.workspaceRoot, agent.cwd) : resolve(input.workspaceRoot);
  const relativeCwd = relative(resolve(input.workspaceRoot), cwd);
  if (relativeCwd.startsWith("..") || isAbsolute(relativeCwd)) {
    throw new Error(`agent_provider_invalid: Agent cwd must stay inside the workspace: ${agent.cwd}`);
  }
  return {
    provider,
    command: agent.command,
    args,
    cwd,
    env: {
      ...safeProviderEnvironment(process.env),
      ...providerEnv,
      ...input.sessionEnv
    },
    startupTimeoutMs: agent.startupTimeoutMs ?? 60_000,
    idleTimeoutMs: agent.idleTimeoutMs ?? 2 * 60_000,
    maxRuntimeMs: agent.maxRuntimeMs ?? null,
    promptVersion: agent.promptVersion ?? "artifact-review-v1",
    model: agent.model
  };
}

registerAgentReviewProvider({
  id: "traex",
  buildLaunch(input) {
    const configured = normalizeTraexArgs(input.actor.agent.args);
    const modelArgs = input.actor.agent.model ? ["--model", input.actor.agent.model] : [];
    const args = [
      "--sandbox", "workspace-write",
      "--ask-for-approval", "never",
      ...modelArgs,
      ...configured,
      "acp", "serve"
    ];
    return commonLaunch("traex", input, args, traexNetworkEnvironment(process.env));
  }
});

function traexNetworkEnvironment(source: NodeJS.ProcessEnv): Record<string, string> {
  const entries = mergeNoProxyEntries(source.NO_PROXY, source.no_proxy, [
    "bytedance.net",
    ".bytedance.net",
    "trae.com.cn",
    ".trae.com.cn"
  ]);
  return { NO_PROXY: entries, no_proxy: entries };
}

function mergeNoProxyEntries(
  upper: string | undefined,
  lower: string | undefined,
  required: readonly string[]
): string {
  const entries = [...(upper ?? "").split(","), ...(lower ?? "").split(","), ...required]
    .map((entry) => entry.trim())
    .filter(Boolean);
  return [...new Set(entries)].join(",");
}

function normalizeTraexArgs(configuredArgs: readonly string[]): string[] {
  const args = [...configuredArgs];
  const acpIndex = args.indexOf("acp");
  if (acpIndex >= 0) {
    if (args[acpIndex + 1] !== "serve") {
      throw new Error("agent_provider_invalid: Traex Agent Review only supports the 'acp serve' subcommand");
    }
    args.splice(acpIndex, 2);
  } else if (args.includes("serve")) {
    throw new Error("agent_provider_invalid: Traex Agent Review only supports the 'acp serve' subcommand");
  }

  const otherSubcommands = new Set([
    "exec", "review", "login", "update", "logout", "mcp", "plugin", "mcp-server",
    "app-server", "remote-control", "completion", "sandbox", "debug", "models", "apply",
    "resume", "fork", "archive", "delete", "unarchive", "exec-server", "features", "doctor", "migrate"
  ]);
  const subcommand = args[0] && otherSubcommands.has(args[0]) ? args[0] : undefined;
  if (subcommand) {
    throw new Error(`agent_provider_invalid: Traex Agent Review cannot launch the '${subcommand}' subcommand`);
  }

  const managed = [
    "--sandbox", "-s",
    "--ask-for-approval", "-a",
    "--permission-mode",
    "--yolo", "-y",
    "--dangerously-bypass-approvals-and-sandbox",
    "--dangerously-bypass-hook-trust"
  ];
  const unsafe = args.find((arg) => managed.some((name) => arg === name || arg.startsWith(`${name}=`)));
  if (unsafe) {
    throw new Error(`agent_provider_invalid: Traex Agent Review does not allow managed security argument '${unsafe}'`);
  }
  return args;
}

function safeProviderEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const exact = new Set([
    "HOME", "PATH", "LANG", "LANGUAGE", "TMPDIR", "TEMP", "TMP", "SHELL",
    "CODEX_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "SSL_CERT_FILE", "SSL_CERT_DIR",
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "no_proxy",
    "NODE_EXTRA_CA_CERTS"
  ]);
  return Object.fromEntries(Object.entries(source).filter(([name, value]) =>
    value !== undefined && (exact.has(name) || name.startsWith("LC_"))
  ));
}
