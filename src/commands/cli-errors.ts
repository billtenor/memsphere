import { Command, CommanderError } from "commander";
import { stringify } from "yaml";

export function emitCommandResult(result: unknown, output: "json" | "text" = "text"): void {
  if (output !== "json" && output !== "text") throw new TypeError("output must be text or json");
  const value = JSON.stringify(result);
  if (value === undefined) throw new TypeError("Command result must be a JSON value");
  process.stdout.write(output === "json" ? `${value}\n` : stringify(JSON.parse(value), { aliasDuplicateObjects: false, lineWidth: 0 }));
}

export function errorCode(error: unknown): string {
  if (error instanceof CommanderError) return "INVALID_ARGUMENT";
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    const codes: Record<string, string> = {
      ENOENT: "NOT_FOUND", EEXIST: "ALREADY_EXISTS", EACCES: "PERMISSION_DENIED", EPERM: "PERMISSION_DENIED"
    };
    return Object.hasOwn(codes, error.code) ? codes[error.code] : error.code;
  }
  if (error instanceof SyntaxError) return "INVALID_INPUT";
  if (error instanceof TypeError || error instanceof RangeError) return "INVALID_ARGUMENT";
  const names: Record<string, string> = {
    MemoryNotFoundError: "NOT_FOUND", MemoryNodeNotFoundError: "NOT_FOUND",
    MemoryAmbiguityError: "AMBIGUOUS_REFERENCE", MemoryReferenceKindError: "INVALID_ARGUMENT",
    InvalidMemoryReferenceError: "INVALID_ARGUMENT", MemoryCatalogDataError: "INVALID_DATA",
    MemoryFrozenError: "MEMORY_FROZEN", ZodError: "INVALID_ARGUMENT"
  };
  return error instanceof Error && Object.hasOwn(names, error.name) ? names[error.name] : "INTERNAL_ERROR";
}

export function emitCommandError(error: unknown, output: "json" | "text" = "text"): void {
  const message = error instanceof Error ? error.message : String(error);
  const details = error && typeof error === "object" && "details" in error ? error.details
    : error instanceof Error && error.name === "ZodError" && "issues" in error ? error.issues : undefined;
  if (output === "json") {
    let value: string;
    try {
      value = JSON.stringify({ error: { code: errorCode(error), message, ...(details === undefined ? {} : { details }) } });
    } catch {
      value = JSON.stringify({ error: { code: errorCode(error), message } });
    }
    process.stderr.write(`${value}\n`);
  } else {
    process.stderr.write(`error: ${message}\n`);
  }
  process.exitCode = 1;
}

/** Find the intended output even when Commander stops before a later --output. */
export function requestedCliOutput(program: Command, args: readonly string[]): "json" | "text" {
  let current = program;
  const path: string[] = [];
  let output: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const token = args[index];
    if (token === "--") break;
    if (token.startsWith("-")) {
      const equals = token.indexOf("=");
      const flag = equals < 0 ? token : token.slice(0, equals);
      const option = inheritedOptions(current).find((candidate) => candidate.long === flag || candidate.short === flag);
      if (flag === "--output") {
        output = equals < 0 ? args[++index] : token.slice(equals + 1);
      } else if (option?.required && equals < 0) {
        index++;
      } else if (option?.optional && equals < 0 && args[index + 1] && !args[index + 1].startsWith("-")) {
        index++;
      }
      continue;
    }
    const child = current.commands.find((command) => command.name() === token || command.aliases().includes(token));
    if (child) {
      current = child;
      path.push(child.name());
    }
  }
  const structured = path[0] === "model" || path[0] === "data"
    || (path[1] === "list" && ["project", "memory", "archive"].includes(path[0]));
  return structured && output === "json" ? "json" : "text";
}

/** Existing non-list commands keep their text errors; new commands and lists share JSON errors. */
export async function parseCli(program: Command, argv = process.argv): Promise<void> {
  const output = requestedCliOutput(program, argv.slice(2));
  const configure = (command: Command) => {
    command.exitOverride();
    command.configureOutput({ outputError: () => undefined });
    for (const child of command.commands) configure(child);
  };
  configure(program);
  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return;
    emitCommandError(error, output);
  }
}

function inheritedOptions(command: Command): Command["options"] {
  return [...command.options, ...(command.parent ? inheritedOptions(command.parent) : [])];
}
