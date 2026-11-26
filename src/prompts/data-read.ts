import { z } from "zod";
import { bool, content, number, text } from "./contracts/types.js";

export const dataReadFields = {
  project: text.optional(),
  storeId: text,
  id: text,
  modelRef: text,
  revision: text.optional(),
  contentType: text.optional(),
  createdAt: number.optional(),
  updatedAt: number.optional(),
  deleted: bool.optional()
};
const metadata = z.object({ ...dataReadFields, deleted: z.literal(false).optional() }).strict();
const withValue = metadata.extend({ value: content });

export const dataReadContract = {
  route: "data read",
  metadata: { schema: metadata, template: "cli.data.read.metadata" },
  deleted: { schema: metadata.extend({ deleted: z.literal(true) }), template: "cli.data.read.metadata" },
  value: { schema: withValue, template: "cli.data.read.content" },
  selectedPath: { schema: withValue, template: "cli.data.read.content" }
} as const;

export const dataReadPrompt = z.object({
  id: z.string(), storeId: z.string(), modelRef: z.string(), project: z.string().optional(),
  revision: z.string().optional(), contentType: z.string().optional(), createdAt: z.string().optional(),
  updatedAt: z.string().optional(), deleted: z.string().optional()
}).strict();
export const dataReadContentPrompt = dataReadPrompt.extend({ body: z.string() });
export type DataReadPrompt = z.infer<typeof dataReadPrompt>;
