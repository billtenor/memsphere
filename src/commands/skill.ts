import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type SkillOptions = {
  force?: boolean;
  directory?: string;
  global?: boolean;
};

const moduleDir = dirname(fileURLToPath(import.meta.url));
const skillNames = ["vibe-mem-edit", "vibe-mem-review", "vibe-mem-run"];

export async function skillInitCommand(options: SkillOptions): Promise<void> {
  if (options.global && options.directory) {
    throw new Error("--global and --directory cannot be used together");
  }

  const base = options.global
    ? join(homedir(), ".agents", "skills")
    : resolve(options.directory ?? ".agents/skills");

  for (const skillName of skillNames) {
    const target = join(base, skillName);
    const filePath = join(target, "SKILL.md");

    await mkdir(target, { recursive: true });

    if (!options.force && await exists(filePath)) {
      throw new Error(`${filePath} already exists. Use --force to overwrite it.`);
    }

    const skillMarkdown = await readSkillMarkdown(skillName);
    await writeFile(filePath, skillMarkdown, "utf8");
    console.log(`Installed ${skillName} skill: ${filePath}`);
  }
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
