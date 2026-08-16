import { z } from "zod";
import { projectControlPlaneConfigSchema } from "../control-plane/schema.js";

export const projectNamePattern = /^[a-z0-9._-]+$/;
export const projectNameSchema = z.string().min(1).regex(projectNamePattern, {
  message: "project name may only contain lowercase ASCII letters, digits, '.', '_' and '-'"
});

export const projectManifestSchema = z.object({
  format_version: z.literal(1),
  name: projectNameSchema,
  created_at: z.string().datetime()
}).strict();

const managedStoreSchema = z.object({
  type: z.literal("managed"),
  branch: z.string().min(1).default("master"),
  upstream: z.string().min(1).optional(),
  published_revision: z.string().min(1)
}).strict();

const embeddedStoreSchema = z.object({
  type: z.literal("embedded"),
  memory_path: z.string().min(1)
}).strict();

export const projectConfigSchema = z.object({
  store: z.discriminatedUnion("type", [managedStoreSchema, embeddedStoreSchema]),
  control_plane: projectControlPlaneConfigSchema.optional()
}).strict();

export type ProjectManifest = z.infer<typeof projectManifestSchema>;
export type ProjectConfigFile = z.infer<typeof projectConfigSchema>;

export type ProjectRecord = {
  name: string;
  root: string;
  missing: boolean;
};

export type ProjectPaths = {
  root: string;
  manifestPath: string;
  configPath: string;
  memoryRoot: string;
  changesRoot: string;
  runsRoot: string;
  reviewsRoot: string;
  archiveRoot: string;
  evalsRoot: string;
  runtimeRoot: string;
};

export function assertProjectName(name: string): string {
  return projectNameSchema.parse(name);
}
