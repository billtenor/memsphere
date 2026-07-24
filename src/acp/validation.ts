import { basename } from "node:path";
import type { AcpProviderType } from "./catalog.js";

export class AcpProviderConfigurationError extends Error {
  constructor(
    readonly field: "command" | "args",
    message: string
  ) {
    super(message);
  }
}

export function validateAcpProviderConfiguration(input: {
  type: AcpProviderType;
  command: string;
  args: readonly string[];
}): string[] {
  validateProviderCommand(input.type, input.command);
  return normalizeProviderArgs(input.type, input.args);
}

export function normalizeProviderArgs(type: AcpProviderType, configuredArgs: readonly string[]): string[] {
  switch (type) {
    case "traex":
      return normalizeTraexArgs(configuredArgs);
    case "qwen":
      return normalizeQwenArgs(configuredArgs);
    case "kimi":
      return normalizeKimiArgs(configuredArgs);
    case "codex":
      return normalizeCodexArgs(configuredArgs);
  }
}

function validateProviderCommand(type: AcpProviderType, command: string): void {
  if (type !== "codex") return;
  const executable = basename(command).toLowerCase().replace(/\.(?:cmd|exe)$/i, "");
  if (["npx", "npm", "pnpm", "yarn", "bun", "bunx", "corepack"].includes(executable)) {
    throw new AcpProviderConfigurationError(
      "command",
      "Codex Provider command must resolve to an installed codex-acp executable; package runners are not allowed"
    );
  }
}

function normalizeTraexArgs(configuredArgs: readonly string[]): string[] {
  const args = [...configuredArgs];
  const acpIndex = args.indexOf("acp");
  if (acpIndex >= 0) {
    if (args[acpIndex + 1] !== "serve") {
      throw invalidArgs("Traex only supports the 'acp serve' subcommand");
    }
    args.splice(acpIndex, 2);
  } else if (args.includes("serve")) {
    throw invalidArgs("Traex only supports the 'acp serve' subcommand");
  }
  rejectSubcommands(args, [
    "exec", "review", "login", "update", "logout", "mcp", "plugin", "mcp-server",
    "app-server", "remote-control", "completion", "sandbox", "debug", "models", "apply",
    "resume", "fork", "archive", "delete", "unarchive", "exec-server", "features", "doctor", "migrate"
  ], "Traex");
  rejectManagedArgs(args, [
    "--model", "-m", "--config", "-c", "--sandbox", "-s", "--ask-for-approval", "-a", "--permission-mode",
    "--yolo", "-y", "--dangerously-bypass-approvals-and-sandbox", "--dangerously-bypass-hook-trust"
  ], "Traex");
  return args;
}

function normalizeQwenArgs(configuredArgs: readonly string[]): string[] {
  const args = [...configuredArgs];
  rejectManagedArgs(args, [
    "--acp", "--experimental-acp", "--model", "-m", "--approval-mode", "--yolo",
    "--prompt", "-p", "--input-format", "--output-format"
  ], "Qwen");
  return args;
}

function normalizeKimiArgs(configuredArgs: readonly string[]): string[] {
  const args = [...configuredArgs];
  const acpIndex = args.indexOf("acp");
  if (acpIndex >= 0) args.splice(acpIndex, 1);
  rejectSubcommands(args, ["login", "web", "doctor", "export", "migrate", "upgrade", "provider"], "Kimi");
  rejectManagedArgs(args, [
    "--model", "-m", "--auto", "--yolo", "-y", "--auto-approve", "--yes",
    "--plan", "--prompt", "-p", "--session", "-S", "--continue", "-c"
  ], "Kimi");
  return args;
}

function normalizeCodexArgs(configuredArgs: readonly string[]): string[] {
  const args = [...configuredArgs];
  rejectManagedArgs(args, ["--version", "-V", "--help", "-h"], "Codex");
  return args;
}

function rejectSubcommands(args: readonly string[], commands: readonly string[], label: string): void {
  const command = args.find((arg) => commands.includes(arg));
  if (command) throw invalidArgs(`${label} cannot launch the '${command}' subcommand`);
}

function rejectManagedArgs(args: readonly string[], managed: readonly string[], label: string): void {
  const unsafe = args.find((arg) => managed.some((name) => arg === name || arg.startsWith(`${name}=`)));
  if (unsafe) throw invalidArgs(`${label} does not allow managed argument '${unsafe}'`);
}

function invalidArgs(message: string): AcpProviderConfigurationError {
  return new AcpProviderConfigurationError("args", message);
}
