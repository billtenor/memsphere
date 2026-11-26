import { withActionScope } from "../prompts/contracts/actions.js";
import { acceptsPublicError } from "../prompts/contracts/errors.js";
import { publicReceipt, commandCases, type OutputScope, cliProtocol } from "../prompts/contracts/dispatch.js";
import { writeCliChunk } from "../cli-transport.js";
import { paginateItems, type CursorScope, type PaginationOptions } from "../pagination.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFile } from "node:fs/promises";
import { type Command, Option } from "commander";
import { stringify } from "yaml";
import { z } from "zod";
import { homePaths, resolveMemsphereHome } from "../home.js";
import { type CliAction, type CliHelpPrompt, type CliResultPrompt, cliCommandSchema, cliErrorPromptSchema } from "../prompts/cli-output.js";
import { defaultPromptLocale, resolvePromptLocale, type PromptLocale } from "../prompts/locale.js";
import { renderPrompt } from "../prompts/renderer.js";
import { formatCliCommand, type CliCommand } from "../prompts/cli-command.js";
export { formatCliCommand, type CliCommand };

export type CliFormat = "text" | "json" | "yaml";
export function addCliOutput(command: Command): Command {
  return command.addOption(new Option("--output <format>", "output format").choices(["text", "json"]).default("text"));
}

/** Register the leaf from its contract and reject placement under a different command group. */
export function commandFromContract(parent: Command, contract: { readonly route: string }): Command {
  const path = contract.route.split(" ");
  const leaf = path.pop();
  const groups: string[] = [];
  for (let command: Command | null = parent; command?.parent; command = command.parent) groups.unshift(command.name());
  if (!leaf || groups.join(" ") !== path.join(" ")) throw new Error(`Invalid CLI contract placement: ${contract.route}`);
  return parent.command(leaf);
}

type Invocation = { format: CliFormat; locale: PromptLocale; scope?: OutputScope; program?: Command; reviewerProtocol?: "graph" | "flow"; pending: Promise<void>[] };
const invocation = new AsyncLocalStorage<Invocation>();

export function setReviewerOutputProtocol(protocol: "graph" | "flow") {
  const state = invocation.getStore();
  if (state) state.reviewerProtocol = protocol;
}

export function bindCliOutputs(program: Command): void {
  program.hook("preAction", (_root, leaf) => {
    const state = invocation.getStore();
    if (!state) return;
    const names: string[] = [];
    for (let part: Command | null = leaf; part?.parent; part = part.parent) names.unshift(part.name());
    const continuation = program.name() === "continue";
    if (continuation) names.unshift("continue");
    const route = names.join(" ");
    const reviewer = Boolean(process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID);
    const role = continuation ? reviewer ? "reviewerContinue" : "runnerContinue" : reviewer ? "reviewer" : "native";
    // Intermediate Continue groups with no leaf operation render scoped help.
    if (route !== "continue" && !commandCases(role, route) && !leaf.commands.length && !(role === "native" && cliProtocol(route))) {
      throw new CliOutputError(undefined, new Error("Unregistered CLI route " + route));
    }
    state.program = program;
    state.scope = { route, role, options: { ...leaf.opts() }, args: leaf.processedArgs.slice() };
  });
}

export async function flushCliOutput(): Promise<void> {
  const state = invocation.getStore();
  if (state) await Promise.all(state.pending.splice(0));
}


export async function withCliOutput<T>(format: CliFormat, run: () => Promise<T>): Promise<T> {
  let locale = defaultPromptLocale;
  try {
    const raw: unknown = JSON.parse(await readFile(homePaths(resolveMemsphereHome()).configPath, "utf8"));
    if (raw && typeof raw === "object" && "language" in raw) locale = resolvePromptLocale(raw.language);
  } catch {
    // Startup and help can run before Home exists. Configuration errors keep
    // their own CLI diagnostic and never affect the ability to print a reply.
  }
  return invocation.run({ format, locale, reviewerProtocol: invocation.getStore()?.reviewerProtocol, pending: [] }, run);
}

export function cliFormat(fallback: CliFormat = "text"): CliFormat {
  return invocation.getStore()?.format ?? fallback;
}

export function cliLocale(): PromptLocale {
  return invocation.getStore()?.locale ?? defaultPromptLocale;
}

export function cliHelpNote(topic: CliHelpPrompt["topic"]): string {
  return "\n" + renderPrompt("cli.help", cliLocale(), { topic }) + "\n";
}

export function cliCommand(args: string[], launcher: CliCommand["launcher"] = "memsphere"): CliCommand {
  return { kind: "command", launcher, args };
}

export function previewText(value: string, maximum: number): { text: string; truncated: boolean } {
  const characters = Array.from(value);
  const truncated = characters.length > maximum;
  return { text: truncated ? characters.slice(0, maximum).join("") : value, truncated };
}

function escapeDisplayControls(value: string): string {
  return value.replace(/[\x7f-\x9f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu,
    char => "\\u" + char.charCodeAt(0).toString(16).padStart(4, "0"));
}

export function inline(value: unknown): string {
  if (typeof value === "string") {
    // A title or preview is data in a single display position. JSON quoting
    // makes line breaks, escapes and terminal controls visible as characters.
    const escaped = escapeDisplayControls(value);
    return value === "" || escaped !== value || /[\s\x00-\x1f`#<>]/u.test(value)
      ? escapeDisplayControls(JSON.stringify(value))
      : value;
  }
  return escapeDisplayControls(JSON.stringify(value) ?? "");
}

function displayValue(value: unknown): string {
  const command = cliCommandSchema.safeParse(value);
  return command.success ? formatCliCommand(command.data) : inline(value);
}

function itemText(item: unknown): string {
  if (item && !Array.isArray(item) && typeof item === "object") {
    return Object.entries(item).filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}=${displayValue(value)}`).join(" ");
  }
  return inline(item);
}

export function cliPageBudget<T>(sizing: "established" | "summary", project: (value: T) => unknown = value => value) {
  return {
    defaultLimit: sizing === "summary" ? 20 : 100,
    maxLimit: sizing === "summary" ? 100 : 1000,
    defaultBytes: 31 * 1024,
    maxBytes: 127 * 1024,
    rowBytes: (value: T) => {
      const row = project(value);
      return Math.max(Buffer.byteLength(JSON.stringify(row)), Buffer.byteLength(itemText(row))) + 4;
    }
  };
}

/** Bind a completed mutation to its public identity and a read-only verification command. */
export function savedResult(id: string, args?: string[], project?: string) {
  return { id, inspect: args && cliCommand([...(project ? ["--project", project] : []), ...args]) };
}

export function paginateCliItems<T>(
  items: readonly T[], options: PaginationOptions, scope: CursorScope, sizing: "established" | "summary"
) {
  return paginateItems(items, options, scope, cliPageBudget<T>(sizing));
}

function presentAction(action: CliAction): NonNullable<CliResultPrompt["action"]> {
  let commands: CliCommand[];
  if (action.kind === "command") commands = [action];
  else if (action.kind === "choose") commands = [...action.choices, ...(action.more ? [action.more] : [])];
  else commands = action.resume ? [action.resume] : [];
  return { kind: action.kind, commands: commands.map(command => formatCliCommand(command)) };
}

type ResultOptions = {
  format?: CliFormat;
  locale?: PromptLocale;
  contentField?: string;
  contentStream?: boolean;
  itemsField?: string;
  maximumBytes?: number;
  saved?: { id: string; inspect?: CliCommand };
};

export class CliOutputError extends Error {
  readonly code = "OUTPUT_RENDER_FAILED";
  constructor(
    readonly saved: ResultOptions["saved"],
    cause: unknown
  ) {
    super("The command result could not be rendered.", { cause });
  }
}

export function publishResult(command: string, value: unknown, options: ResultOptions = {}): void {
  const state = invocation.getStore();
  const output = renderCommandResult(command, value, options);
  if (!state) { process.stdout.write(output); return; }
  const pending = writeCliChunk(output).catch(error => { throw new CliOutputError(options.saved, error); });
  // Commander actions can be synchronous. Attach a rejection listener now,
  // and propagate the error from the dispatch completion boundary.
  void pending.catch(() => {});
  state.pending.push(pending);
}

export function validateCommandResult(command: string, value: unknown, saved?: ResultOptions["saved"]) {
  const state = invocation.getStore();
  const scope = state?.scope;
  try {
    if (scope && state.program) {
      return withActionScope({ program: state.program, reviewer: scope.role.startsWith("reviewer"),
        protocol: state.reviewerProtocol, project: process.env.MEMSPHERE_PROJECT }, () => publicReceipt(scope, value));
    }
    return publicReceipt(scope ?? { route: command, role: "native", options: {}, args: [] }, value, scope !== undefined);
  } catch (error) {
    throw new CliOutputError(saved, error);
  }
}

export function renderCommandResult(command: string, value: unknown, options: ResultOptions = {}): string {
  try {
    const selected = validateCommandResult(command, typeof value === "function" ? value() : value, options.saved);
    const scope = invocation.getStore()?.scope;
    const route = scope?.route ?? command;
    const fullContent = options.contentField || command === "run artifact contract show"
      || command === "run artifact show" && ("artifact" in selected || "contextArtifacts" in selected)
      || command === "run review show" && (scope?.options.all || "node" in selected || "nodes" in selected)
      || command === "run schema show" || command === "run step show";
    const paged = /(?:^| )list$/.test(route) || "nextCursor" in selected;
    const maximumBytes = options.maximumBytes ?? (fullContent ? undefined : paged
      ? scope?.options.limit === undefined ? 32768 : 131072 : 8192);
    return renderCliResult(route, z.record(z.unknown()), selected, { ...options, maximumBytes });
  } catch (error) {
    if (error instanceof CliOutputError) throw error;
    throw new CliOutputError(options.saved, error);
  }
}

export function renderCliResult<Schema extends z.ZodTypeAny>(
  command: string,
  schema: Schema,
  value: z.input<Schema>,
  options: ResultOptions = {}
): string {
  let output: string;
  try {
    const result = schema.parse(value);
    const format = options.format ?? cliFormat();
    if (format === "json") output = `${JSON.stringify(result)}\n`;
    else if (format === "yaml") output = stringify(result, { aliasDuplicateObjects: false, lineWidth: 0 });
    else {
      const { nextAction, ...details } = result;
      const itemsField = options.itemsField ?? "items";
      const items = details[itemsField];
      const content = options.contentField ? details[options.contentField] : undefined;
      const facts = Object.entries(details)
        .filter(([key, value]) => value !== undefined && key !== options.contentField && key !== itemsField)
        .map(([label, value]) => ({
          label,
          value: displayValue(value)
        }));
      output = renderPrompt("cli.result", options.locale ?? cliLocale(), {
        command, facts, items: (items ?? []).map(itemText),
        content: options.contentStream ? "" : content === undefined ? undefined : inline(content),
        action: nextAction ? presentAction(nextAction) : undefined
      }) + "\n";
    }
    if (options.maximumBytes !== undefined && Buffer.byteLength(output) > options.maximumBytes) {
      throw new RangeError("Public result exceeds its output budget");
    }
  } catch (error) {
    throw new CliOutputError(options.saved, error);
  }
  return output;
}

export type PublicCliError = {
  code: string;
  details?: {
    runId?: string;
    stepId?: string;
    artifactId?: string;
    changeId?: string;
    checkpointDigest?: string;
    savedId?: string;
    candidateIds?: string[];
    candidateReferences?: string[];
    id?: string;
    revision?: string;
    expectedRevision?: string;
    actualRevision?: string;
    modelRef?: string;
    path?: string;
    protocol?: "graph" | "flow";
    storeIds?: string[];
    diagnostics?: { code: string; path?: string[]; field?: string }[];
    correctable?: boolean;
    issueCount?: number;
    data?: { storeId: string; checked: number; failureCount: number; failures: { id: string }[] }[];
  };
  nextAction?: CliAction;
};

export function renderCliError(result: PublicCliError, format: CliFormat, locale: PromptLocale): string {
  if (!acceptsPublicError(result) && result.nextAction) result = { code: result.code, details: result.details };
  if (!acceptsPublicError(result) || Buffer.byteLength(JSON.stringify(result)) > 8000) {
    result = { code: acceptsPublicError({ code: result.code }) ? result.code : "INTERNAL_ERROR" };
  }
  if (format === "json") return `${JSON.stringify({ error: result })}\n`;
  const facts = Object.entries(result.details ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([label, value]) => ({ label, value: inline(value) }));
  const input: z.input<typeof cliErrorPromptSchema> = {
    code: result.code, facts,
    action: result.nextAction ? presentAction(result.nextAction).commands[0] : undefined
  };
  try {
    return renderPrompt("cli.error", locale, input) + "\n";
  } catch {
    // A template failure can still return the minimal recovery receipt.
    return `${JSON.stringify({ error: result })}\n`;
  }
}

export async function emitCliError(error: CliOutputError | PublicCliError, options: { nonfatal?: boolean } = {}): Promise<void> {
  const result = error instanceof CliOutputError
    ? { code: error.code, details: error.saved ? { savedId: error.saved.id } : undefined, nextAction: error.saved?.inspect }
    : error;
  if (!options.nonfatal) process.exitCode = 1;
  const state = invocation.getStore();
  const reviewer = Boolean(process.env.MEMSPHERE_REVIEW_ASSIGNMENT_ID);
  const render = () => renderCliError(result, cliFormat(), cliLocale());
  try {
    const output = state?.program
      ? withActionScope({ program: state.program, reviewer, protocol: state.reviewerProtocol, project: process.env.MEMSPHERE_PROJECT }, render)
      : renderCliError(reviewer ? { code: result.code, details: result.details } : result, cliFormat(), cliLocale());
    await writeCliChunk(output, process.stderr);
  }
  catch { /* Both channels may have closed. The exit status still records failure. */ }
}
