export const runnerSessionVariables = {
  codex: "CODEX_THREAD_ID",
  traex: "TRAECLI_THREAD_ID",
  claude: "CLAUDE_CODE_SESSION_ID"
} as const;

export type AgentType = keyof typeof runnerSessionVariables;
export const agentTypes = Object.keys(runnerSessionVariables) as AgentType[];

export function stripRunnerEnvironment(env: NodeJS.ProcessEnv): void {
  for (const variable of Object.values(runnerSessionVariables)) delete env[variable];
  delete env.CLAUDE_CODE_MESSAGING_SOCKET;
  delete env.CLAUDE_CODE_MESSAGING_TOKEN;
}
