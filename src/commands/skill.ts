import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";
import { savedResult, publishResult } from "./output.js";

const skillResult = z.object({
  skill: z.string(),
  path: z.string(),
  status: z.enum(["installed", "upgraded"])
}).strict();

type SkillOptions = {
  force?: boolean;
  directory?: string;
  global?: boolean;
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const skillName = "memsphere";

export async function skillInitCommand(options: SkillOptions): Promise<void> {
  await installSkill("init", options);
}

async function installSkill(operation: "init" | "upgrade", options: SkillOptions): Promise<void> {
  if (options.global && options.directory) {
    throw Object.assign(new Error("--global and --directory cannot be used together"), {
      code: "INVALID_ARGUMENT", issues: [{ code: "mutually_exclusive", path: ["--global", "--directory"] }]
    });
  }

  const base = options.global
    ? join(homedir(), ".agents", "skills")
    : resolve(options.directory ?? ".agents/skills");

  const target = join(base, skillName);
  const filePath = join(target, "SKILL.md");
  await mkdir(target, { recursive: true });

  if (!options.force && await exists(filePath)) {
    throw Object.assign(new Error("The Skill already exists"), { code: "ALREADY_EXISTS" });
  }

  const skillMarkdown = await readSkillMarkdown(skillName);
  await writeFile(filePath, skillMarkdown, "utf8");
  publishResult(`skill ${operation}`, () => skillResult.parse({
    skill: skillName, path: filePath, status: operation === "init" ? "installed" : "upgraded"
  }), { saved: savedResult(filePath) });
}

/** Update the selected Skill installation using the same contract as init --force. */
export async function skillUpgradeCommand(options: Omit<SkillOptions, "force">): Promise<void> {
  await installSkill("upgrade", { ...options, force: true });
}

async function readSkillMarkdown(skillName: string): Promise<string> {
  const candidates = [
    join(moduleDir, "../skills", skillName, "SKILL.md"),
    join(moduleDir, "../../src/skills", skillName, "SKILL.md")
  ];

  for (const path of candidates) {
    if (await exists(path)) {
      return readFile(path, "utf8");
    }
  }

  throw new Error(`${skillName} skill source not found. Checked: ${candidates.join(", ")}`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
