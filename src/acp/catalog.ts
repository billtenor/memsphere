export const acpProviderTypes = ["traex", "qwen", "kimi", "codex"] as const;

export type AcpProviderType = typeof acpProviderTypes[number];

export type AcpProviderInstance = {
  type: AcpProviderType;
  command: string;
  args: string[];
  env: Record<string, string>;
  startupTimeoutMs: number;
  idleTimeoutMs: number;
  maxRuntimeMs: number | null;
};

export type AcpProviderDefinition = {
  type: AcpProviderType;
  name: string;
  defaultCommand: string;
  versionArgs: string[];
  installHelp: string;
};

const definitions: Record<AcpProviderType, AcpProviderDefinition> = {
  traex: {
    type: "traex",
    name: "Traex",
    defaultCommand: "traex",
    versionArgs: ["--version"],
    installHelp: "Install and authenticate Traex CLI before using this Provider."
  },
  qwen: {
    type: "qwen",
    name: "Qwen Code",
    defaultCommand: "qwen",
    versionArgs: ["--version"],
    installHelp: "Install Qwen Code and configure its model Provider before using this Provider."
  },
  kimi: {
    type: "kimi",
    name: "Kimi Code CLI",
    defaultCommand: "kimi",
    versionArgs: ["--version"],
    installHelp: "Install and authenticate Kimi Code CLI before using this Provider."
  },
  codex: {
    type: "codex",
    name: "Codex",
    defaultCommand: "codex-acp",
    versionArgs: ["--version"],
    installHelp: "Install @agentclientprotocol/codex-acp and authenticate Codex before using this Provider."
  }
};

export function listAcpProviderDefinitions(): AcpProviderDefinition[] {
  return acpProviderTypes.map((type) => structuredClone(definitions[type]));
}

export function requireAcpProviderDefinition(type: AcpProviderType): AcpProviderDefinition {
  return structuredClone(definitions[type]);
}

export function defaultAcpProviderInstance(type: AcpProviderType): AcpProviderInstance {
  return {
    type,
    command: definitions[type].defaultCommand,
    args: [],
    env: {},
    startupTimeoutMs: 60_000,
    idleTimeoutMs: 120_000,
    maxRuntimeMs: null
  };
}

export function defaultAcpProviderInstances(): Record<string, AcpProviderInstance> {
  return Object.fromEntries(acpProviderTypes.map((type) => [type, defaultAcpProviderInstance(type)]));
}
