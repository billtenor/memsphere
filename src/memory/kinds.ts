export const memoryKinds = ["procedures", "concepts", "statements", "schemas"] as const;

export type MemoryKind = (typeof memoryKinds)[number];

export const memoryKindTags = {
  procedures: "!procedure",
  concepts: "!concept",
  statements: "!statement",
  schemas: "!schema"
} as const satisfies Record<MemoryKind, string>;

export const memoryKindLabels = {
  procedures: "procedure",
  concepts: "concept",
  statements: "statement",
  schemas: "schema"
} as const satisfies Record<MemoryKind, string>;

export function isMemoryKind(value: string): value is MemoryKind {
  return (memoryKinds as readonly string[]).includes(value);
}
