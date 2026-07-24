import { resolve } from "node:path";
import type { ControlPlaneActor } from "../control-plane/index.js";
import type { AcpProviderType } from "./catalog.js";
import { validateAcpProviderConfiguration } from "./validation.js";

type AgentActor = Extract<ControlPlaneActor, { kind: "agent" }>;

export const currentAgentReviewPromptVersion = "artifact-review-v1";

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
  id: AcpProviderType;
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
  provider: AcpProviderType,
  input: Parameters<AgentReviewProvider["buildLaunch"]>[0],
  args: string[],
  providerEnv: Record<string, string> = {}
): AgentReviewProviderLaunch {
  const agent = input.actor.agent;
  return {
    provider,
    command: agent.command,
    args,
    cwd: resolve(input.workspaceRoot),
    env: {
      ...safeProviderEnvironment(process.env),
      ...agent.env,
      ...providerEnv,
      ...input.sessionEnv
    },
    startupTimeoutMs: agent.startupTimeoutMs,
    idleTimeoutMs: agent.idleTimeoutMs,
    maxRuntimeMs: agent.maxRuntimeMs,
    promptVersion: currentAgentReviewPromptVersion,
    model: agent.model
  };
}

function configuredArgs(
  provider: AcpProviderType,
  input: Parameters<AgentReviewProvider["buildLaunch"]>[0]
): string[] {
  return validateAcpProviderConfiguration({
    type: provider,
    command: input.actor.agent.command,
    args: input.actor.agent.args
  });
}

registerAgentReviewProvider({
  id: "traex",
  buildLaunch(input) {
    const configured = configuredArgs("traex", input);
    const modelArgs = input.actor.agent.model ? ["--model", input.actor.agent.model] : [];
    return commonLaunch("traex", input, [
      "--sandbox", "workspace-write",
      "--ask-for-approval", "never",
      ...modelArgs,
      ...configured,
      "acp", "serve"
    ], traexNetworkEnvironment(process.env));
  }
});

registerAgentReviewProvider({
  id: "qwen",
  buildLaunch(input) {
    const configured = configuredArgs("qwen", input);
    const modelArgs = input.actor.agent.model ? ["--model", input.actor.agent.model] : [];
    return commonLaunch("qwen", input, [
      ...modelArgs,
      "--approval-mode=auto",
      ...configured,
      "--acp"
    ]);
  }
});

registerAgentReviewProvider({
  id: "kimi",
  buildLaunch(input) {
    const configured = configuredArgs("kimi", input);
    const modelArgs = input.actor.agent.model ? ["--model", input.actor.agent.model] : [];
    return commonLaunch("kimi", input, [
      ...modelArgs,
      "--auto",
      ...configured,
      "acp"
    ]);
  }
});

registerAgentReviewProvider({
  id: "codex",
  buildLaunch(input) {
    const configured = configuredArgs("codex", input);
    return commonLaunch("codex", input, configured, {
      NO_BROWSER: "1",
      INITIAL_AGENT_MODE: "read-only",
      ...(input.actor.agent.model
        ? { CODEX_CONFIG: JSON.stringify({ model: input.actor.agent.model }) }
        : {})
    });
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
