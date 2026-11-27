import { z } from "zod";

export const cliCommandSchema = z.object({
  kind: z.literal("command"),
  launcher: z.enum(["memsphere", "reviewer"]),
  args: z.array(z.string())
}).strict();

const cliActionSchema = z.discriminatedUnion("kind", [
  cliCommandSchema,
  z.object({ kind: z.literal("choose"), choices: z.array(cliCommandSchema.extend({ label: z.string().min(1).optional() })).max(10), more: cliCommandSchema.optional() }).strict(),
  z.object({ kind: z.literal("wait"), resume: cliCommandSchema.optional() }).strict(),
  z.object({ kind: z.literal("human_confirmation"), resume: cliCommandSchema.optional() }).strict()
]);

export const nextAction = cliActionSchema.optional();
export type CliAction = z.infer<typeof cliActionSchema>;

export const cliResultPromptSchema = z.object({
  command: z.string(),
  facts: z.array(z.object({ label: z.string(), value: z.string() }).strict()),
  items: z.array(z.string()),
  content: z.string().optional(),
  action: z.object({
    kind: z.enum(["command", "choose", "wait", "human_confirmation"]),
    commands: z.array(z.string())
  }).strict().optional()
}).strict();

export const cliErrorPromptSchema = z.object({
  code: z.string(),
  facts: z.array(z.object({ label: z.string(), value: z.string() }).strict()),
  action: z.string().optional()
}).strict();

export type CliResultPrompt = z.infer<typeof cliResultPromptSchema>;
export type CliErrorPrompt = z.infer<typeof cliErrorPromptSchema>;

export const cliNotificationSchema = z.object({ command: z.string() }).strict();
export type CliNotification = z.infer<typeof cliNotificationSchema>;

export const cliContinueSchema = z.object({
  project: z.string(),
  runId: z.string(),
  stepId: z.string().optional(),
  reviewId: z.string().optional(),
  status: z.string(),
  available: z.boolean(),
  commands: z.array(z.string()),
  usage: z.string().optional()
}).strict();
export type CliContinuePrompt = z.infer<typeof cliContinueSchema>;

export const cliHelpSchema = z.object({
  topic: z.enum(["project-repair", "validate", "reviewer-protocol"])
}).strict();
export type CliHelpPrompt = z.infer<typeof cliHelpSchema>;
