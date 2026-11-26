import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import type * as acp from "@agentclientprotocol/sdk";
import { claudeAcpVersion } from "./catalog.js";

export function assertClaudeAdapter(agentInfo?: { name: string; version?: string } | null) {
  if (agentInfo?.name !== "@agentclientprotocol/claude-agent-acp" || agentInfo.version !== claudeAcpVersion) {
    throw new Error(`agent_provider_unsupported: Claude Reviewer requires verified claude-agent-acp ${claudeAcpVersion}`);
  }
}

export function claudeReviewerSession(cwd: string, model?: string): acp.NewSessionRequest {
  return {
    cwd,
    mcpServers: [],
    _meta: {
      claudeCode: {
        options: {
          tools: ["Bash", "Read"],
          settings: { permissions: { ask: ["Bash", "Read"] } },
          allowDangerouslySkipPermissions: false,
          strictMcpConfig: true,
          extraArgs: { "safe-mode": null },
          ...(model ? { model } : {})
        }
      }
    }
  };
}

// Only the Attempt launcher followed by literal shell arguments may execute.
// In particular, expansion inside shell double quotes and additional commands
// could expose the Reviewer's environment or bypass the launcher.
const launcherCommand = /^"\$MEMSPHERE_CLI"(?:[ \t]+(?:[A-Za-z0-9._/@%:+,=-]+|'[^'\r\n]*'|"[^"\\$\x60\r\n]*"))+[ \t]*$/;

export async function authorizeClaudeTool(
  params: acp.RequestPermissionRequest,
  workspaceRoot: string,
  sessionId?: string
): Promise<acp.RequestPermissionResponse> {
  const denied: acp.RequestPermissionResponse = { outcome: { outcome: "cancelled" } };
  if (!sessionId || params.sessionId !== sessionId) return denied;
  const allow = params.options.find(option => option.kind === "allow_once");
  const raw = params.toolCall.rawInput;
  if (!allow || !raw || typeof raw !== "object" || Array.isArray(raw)) return denied;
  const input = raw as Record<string, unknown>;
  const executable = params.toolCall.kind === "execute"
    && Object.keys(input).every(key => ["command", "description", "timeout"].includes(key))
    && typeof input.command === "string" && input.command.length <= 16_384
    && !/[\r\n]/.test(input.command) && launcherCommand.test(input.command);
  const readable = params.toolCall.kind === "read"
    && typeof input.file_path === "string" && await isAttemptFile(workspaceRoot, input.file_path);
  return executable || readable
    ? { outcome: { outcome: "selected", optionId: allow.optionId } }
    : denied;
}

async function isAttemptFile(workspaceRoot: string, path: string): Promise<boolean> {
  if (!isAbsolute(path)) return false;
  try {
    const root = await realpath(workspaceRoot);
    const target = await realpath(path);
    const child = relative(root, target);
    return Boolean(child && child !== ".." && !child.startsWith(`..${sep}`)
      && !isAbsolute(child) && (await stat(target)).isFile());
  } catch {
    return false;
  }
}
