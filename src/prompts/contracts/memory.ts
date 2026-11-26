import { action, bool, content, either, integer, list, nil, oneOf, text } from "./types.js";
import { publicMemoryChangeShowFilesItem, publicMemoryChangeShowFilesItem2, publicMemoryChangeShowValidation, publicMemoryEditTargetsItem, publicMemoryListEntryItem, publicMemoryListEntryItem2, publicMemoryListMemory, publicMemoryReadContext, publicMemoryReadMemory, publicValidateIssuesItem } from "./fields.js";
import { receipt } from "./types.js";

export const memoryContracts = {
  "memory list": [
    receipt("cli-memory-list-1", "指定 Memory 节点范围", {
      memory: publicMemoryListMemory,
      items: list(publicMemoryListEntryItem),
      parent_node_ref: text.optional(),
      nextCursor: text.optional(),
    }),
    receipt("cli-memory-list-2", "未指定引用 · Memory 摘要页", {
      items: list(publicMemoryListEntryItem2),
      nextCursor: text.optional(),
    }),
  ],
  "memory read": [
    receipt("cli-memory-read-1", "完整 concept", {
      syntax: text,
      tag: text,
      names: list(text),
      defines: list(text),
      extends: list(text).optional(),
    }),
    receipt("cli-memory-read-2", "完整 statement", {
      syntax: text,
      tag: text,
      names: list(text),
      defines: list(text),
      asserts: content.optional(),
      suggests: content.optional(),
      sections: content.optional(),
    }),
    receipt("cli-memory-read-3", "完整 schema", {
      syntax: text,
      tag: text,
      names: list(text),
      defines: list(text),
      asserts: content.optional(),
      suggests: content.optional(),
      optional: bool.optional(),
      type: text.optional(),
      format: content.optional(),
      fields: content.optional(),
      item: content.optional(),
      items: content.optional(),
    }),
    receipt("cli-memory-read-4", "完整 procedure flow", {
      syntax: text,
      tag: text,
      names: list(text),
      defines: list(text),
      goals: list(text),
      flow: content,
      mode: text.optional(),
      asserts: content.optional(),
    }),
    receipt("cli-memory-read-5", "完整 procedure graph", {
      syntax: text,
      tag: text,
      names: list(text),
      defines: list(text),
      goals: list(text),
      mode: text,
      actions: content,
      asserts: content.optional(),
    }),
    receipt("cli-memory-read-6", "--node", {
      memory: publicMemoryReadMemory,
      node_ref: text,
      node_type: text,
      context: publicMemoryReadContext,
      fragment: content,
    }),
    receipt("cli-memory-read-7", "--effective（整份或 --node）", {
      declared: content,
      effective: content.optional(),
    }),
  ],
  "memory edit": [
    receipt("cli-memory-edit-1", "Embedded 可编辑", {
      status: oneOf("ready", "applied", "published", "claimed", "completed", "restored", "pushed", "synchronized"),
      storeType: oneOf("managed", "embedded"),
      targets: list(publicMemoryEditTargetsItem),
      nextAction: action,
    }),
    receipt("cli-memory-edit-2", "可编辑候选", {
      changeId: text,
      status: oneOf("ready", "applied", "published", "claimed", "completed", "restored", "pushed", "synchronized"),
      nextAction: action,
      candidateRoot: text.optional(),
    }),
  ],
  "memory delete": [
    receipt("cli-memory-delete-1", "可编辑候选", {
      changeId: text,
      status: oneOf("ready", "applied", "published", "claimed", "completed", "restored", "pushed", "synchronized"),
      nextAction: action,
      candidateRoot: text.optional(),
    }),
  ],
  "memory rename": [
    receipt("cli-memory-rename-1", "可编辑候选", {
      changeId: text,
      status: oneOf("ready", "applied", "published", "claimed", "completed", "restored", "pushed", "synchronized"),
      nextAction: action,
      candidateRoot: text.optional(),
    }),
  ],
  "memory publish": [
    receipt("cli-memory-publish-1", "操作成功", {
      changeId: text,
      status: oneOf("ready", "applied", "published", "claimed", "completed", "restored", "pushed", "synchronized"),
      storeType: oneOf("managed", "embedded"),
      revision: text.optional(),
      nextAction: action.optional(),
    }),
  ],
  "memory recover": [
    receipt("cli-memory-recover-1", "直接恢复", {
      status: oneOf("ready", "applied", "published", "claimed", "completed", "restored", "pushed", "synchronized"),
      reference: text,
    }),
    receipt("cli-memory-recover-2", "可编辑候选", {
      changeId: text,
      status: oneOf("ready", "applied", "published", "claimed", "completed", "restored", "pushed", "synchronized"),
      nextAction: action,
      candidateRoot: text.optional(),
    }),
  ],
  "memory push": [
    receipt("cli-memory-push-1", "操作成功", {
      status: oneOf("ready", "applied", "published", "claimed", "completed", "restored", "pushed", "synchronized"),
      storeType: oneOf("managed", "embedded"),
    }),
  ],
  "memory sync": [
    receipt("cli-memory-sync-1", "已同步", {
      status: oneOf("ready", "applied", "published", "claimed", "completed", "restored", "pushed", "synchronized"),
      revision: text,
    }),
    receipt("cli-memory-sync-2", "可编辑候选", {
      changeId: text,
      status: oneOf("ready", "applied", "published", "claimed", "completed", "restored", "pushed", "synchronized"),
      nextAction: action,
      candidateRoot: text.optional(),
    }),
  ],
  "memory sync publish": [
    receipt("cli-memory-sync-publish-1", "操作成功", {
      changeId: text,
      status: oneOf("ready", "applied", "published", "claimed", "completed", "restored", "pushed", "synchronized"),
      revision: text.optional(),
    }),
  ],
  "memory change show": [
    receipt("cli-memory-change-show-1", "--part summary", {
      changeId: text,
      project: text,
      checkpointDigest: text,
      status: text,
      baseRevision: text,
      files: list(publicMemoryChangeShowFilesItem),
    }),
    receipt("cli-memory-change-show-2", "--part validation", {
      changeId: text,
      project: text,
      checkpointDigest: text,
      validation: publicMemoryChangeShowValidation,
    }),
    receipt("cli-memory-change-show-3", "--part memory", {
      changeId: text,
      project: text,
      checkpointDigest: text,
      reference: text,
      side: text,
      operation: text,
      content: either(text, nil),
    }),
    receipt("cli-memory-change-show-4", "--part diff", {
      changeId: text,
      project: text,
      checkpointDigest: text,
      files: list(publicMemoryChangeShowFilesItem2),
    }),
  ],
  "memory change resume": [
    receipt("cli-memory-change-resume-1", "可编辑候选", {
      changeId: text,
      status: oneOf("ready", "applied", "published", "claimed", "completed", "restored", "pushed", "synchronized"),
      nextAction: action,
      candidateRoot: text.optional(),
    }),
  ],
  "memory change claim": [
    receipt("cli-memory-change-claim-1", "可编辑候选", {
      changeId: text,
      status: oneOf("ready", "applied", "published", "claimed", "completed", "restored", "pushed", "synchronized"),
      nextAction: action,
      commentCount: integer,
      warningCount: integer,
      candidateRoot: text.optional(),
    }),
  ],
  "memory change finish": [
    receipt("cli-memory-change-finish-1", "操作成功", {
      changeId: text,
      status: oneOf("ready", "applied", "published", "claimed", "completed", "restored", "pushed", "synchronized"),
      commentCount: integer,
    }),
  ],
  "memory change complete": [
    receipt("cli-memory-change-complete-1", "操作成功", {
      changeId: text,
      status: oneOf("ready", "applied", "published", "claimed", "completed", "restored", "pushed", "synchronized"),
    }),
  ],
  "memory change validate": [
    receipt("cli-memory-change-validate-1", "成功", {
      valid: bool,
      changeId: text,
      storeType: oneOf("managed", "embedded"),
      baseRevision: text,
      checkpointDigest: text,
      completedChangeIds: list(text, 20),
      completedChangeCount: integer,
      issueCount: integer,
      issues: list(publicValidateIssuesItem, 10),
      empty: bool,
      previewPath: text,
      previewUrl: text.optional(),
      nextAction: action.optional(),
    }),
  ],
};
