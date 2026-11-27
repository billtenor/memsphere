import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { failure } from "../context_control/errors.js";
import { resolveMemsphereHome } from "../home.js";
import { atomicWriteJson } from "../persistence.js";
import { currentIdentity } from "../runner/identity.js";

const references = z.array(z.string().regex(/^(artifact|external):.+/u));

function candidatePath(owner: string, project: string, run: string, step: string) {
  const key = createHash("sha256").update(JSON.stringify([owner, project, run, step])).digest("hex");
  return join(resolveMemsphereHome(), "data", "session-report-candidates", key + ".json");
}

export async function saveReportCandidates(project: string, run: string, step: string, owner: string, candidates: string[]) {
  const identity = await currentIdentity(true);
  if (identity?.id !== owner) throw failure("SESSION_CONTEXT_CONFLICT", "The reporting session changed");
  await atomicWriteJson(candidatePath(identity.id, project, run, step), references.parse(candidates));
}

export async function readReportCandidates(project: string, run: string, step: string) {
  const identity = await currentIdentity(true);
  if (!identity) throw failure("AGENT_SESSION_REQUIRED", "The reporting session is required");
  try {
    return references.parse(JSON.parse(await readFile(candidatePath(identity.id, project, run, step), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw failure("NOT_FOUND", "This session has no candidate list for this Step");
    throw error;
  }
}
