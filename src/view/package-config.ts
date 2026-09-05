import { createHash } from "node:crypto";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

export const viewPackageCapabilitySchema = z.enum([
  "theme.register",
  "theme.override",
  "styles.scoped",
  "styles.global"
]);

export type ViewPackageCapability = z.infer<typeof viewPackageCapabilitySchema>;

export const portableViewContributionCells = [
  "org.memsphere.memory.page.presentation@1:page",
  "org.memsphere.memory.detail.renderer@1:detail",
  "org.memsphere.run.page.presentation@1:page",
  "org.memsphere.run.artifact.renderer@1:artifact"
] as const;

export const configurableViewSlots = [
  { id: "navigation.primary@1", kind: "list" },
  { id: "navigation.secondary@1", kind: "single" },
  { id: "content.list@1", kind: "single" },
  { id: "search.providers@1", kind: "list" },
  { id: "header.title@1", kind: "single" },
  { id: "header.actions@1", kind: "list" },
  { id: "side.panel@1", kind: "single" },
  { id: "sidebar.footer@1", kind: "list" },
  { id: "home.attention@1", kind: "list" },
  { id: "home.continue@1", kind: "list" },
  { id: "main.view@1", kind: "single" },
  { id: "overlay@1", kind: "single" },
  ...portableViewContributionCells.map(id => ({ id, kind: "single" as const }))
] as const;

const configurableViewSlotIds: ReadonlySet<string> = new Set(configurableViewSlots.map(slot => slot.id));

export function configurableViewSlotIdForCell(cell: string): string | undefined {
  if ((portableViewContributionCells as readonly string[]).includes(cell)) return cell;
  return configurableViewSlots.find(slot => !slot.id.startsWith("org.memsphere.") && cell.startsWith(`${slot.id}:`))?.id;
}

export const viewPackageContributionCellSchema = z.string().min(1).refine(
  value => Boolean(configurableViewSlotIdForCell(value)),
  "View contribution must target a configurable Host Slot"
);

const uniqueCapabilities = z.array(viewPackageCapabilitySchema).superRefine((values, context) => {
  if (new Set(values).size !== values.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "capabilities must be unique" });
  }
});

export const installedViewPackageSchema = z.object({
  path: z.string().min(1).refine(isAbsolute, "installed View Package path must be absolute"),
  allow: uniqueCapabilities.optional()
}).strict();

export const viewThemeOverrideSchema = z.object({
  light: z.record(z.string().min(1)).optional(),
  dark: z.record(z.string().min(1)).optional()
}).strict().superRefine((value, context) => {
  if (Boolean(value.light) !== Boolean(value.dark)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Theme overrides must provide both light and dark token maps" });
  }
});

export const globalViewThemeConfigSchema = z.object({
  mode: z.enum(["light", "dark", "system"]).default("system"),
  selected_source: z.string().min(1).optional(),
  preferences: z.record(z.string().min(1)).optional(),
  overrides: viewThemeOverrideSchema.optional()
}).strict();

export const projectViewPackageSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  enabled: z.boolean().default(true),
  allow: uniqueCapabilities.optional(),
  instance_id: z.string().min(1).optional(),
  config: z.record(z.unknown()).optional(),
  preferences: z.record(z.string().min(1)).optional()
}).strict();

export const projectViewThemeConfigSchema = z.object({
  mode: z.enum(["light", "dark", "system"]).optional(),
  selected_source: z.string().min(1).optional(),
  preferences: z.record(z.string().min(1)).optional(),
  overrides: viewThemeOverrideSchema.optional()
}).strict();

const projectViewSlotSelectionsSchema = z.record(z.union([z.string().min(1), z.array(z.string().min(1)), z.null()])).superRefine((value, context) => {
  for (const cell of Object.keys(value)) {
    if (!configurableViewSlotIds.has(cell)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [cell], message: `unknown configurable View Slot: ${cell}` });
    }
  }
});

export const projectViewConfigSchema = z.object({
  packages: z.array(projectViewPackageSchema).default([]),
  theme: projectViewThemeConfigSchema.optional(),
  slots: projectViewSlotSelectionsSchema.optional(),
  styles: z.record(z.boolean()).optional()
}).strict().superRefine((view, context) => {
  const identities = new Set<string>();
  for (const [index, entry] of view.packages.entries()) {
    const identity = `${entry.id}@${entry.version}#${entry.instance_id ?? entry.id}`;
    if (identities.has(identity)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["packages", index],
        message: `duplicate View Package instance: ${identity}`
      });
    }
    identities.add(identity);
  }
});

export const globalViewPackagesConfigSchema = z.object({
  installed: z.array(installedViewPackageSchema).default([])
}).strict().superRefine((value, context) => {
  const paths = new Set<string>();
  for (const [index, entry] of value.installed.entries()) {
    const normalized = resolve(entry.path);
    if (paths.has(normalized)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["installed", index, "path"],
        message: `duplicate installed View Package path: ${normalized}`
      });
    }
    paths.add(normalized);
  }
});

export type GlobalViewPackagesConfig = z.infer<typeof globalViewPackagesConfigSchema>;
export type GlobalViewThemeConfig = z.infer<typeof globalViewThemeConfigSchema>;
export type ProjectViewConfig = z.infer<typeof projectViewConfigSchema>;

export function normalizeInstalledViewPackagePaths(
  value: GlobalViewPackagesConfig | undefined,
): GlobalViewPackagesConfig | undefined {
  if (!value) return undefined;
  return globalViewPackagesConfigSchema.parse({
    installed: value.installed.map((entry) => ({
      path: resolve(entry.path),
      ...(entry.allow?.length ? { allow: [...entry.allow].sort() } : {})
    }))
  });
}

export function viewCompositionDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)])
  );
}
