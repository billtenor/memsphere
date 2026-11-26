import { action, integer, list, oneOf, text } from "./types.js";
import { publicMigrateSyntaxIssuesItem } from "./fields.js";
import { receipt } from "./types.js";

export const migrateContracts = {
  "migrate syntax": [
    receipt("cli-migrate-syntax-1", "成功", {
      mode: oneOf("check", "write"),
      migration: oneOf("memory-syntax", "artifact-contract-v2", "schema-contract-v2"),
      status: oneOf("ready", "blocked"),
      affectedFiles: integer,
      issueCount: integer,
      issues: list(publicMigrateSyntaxIssuesItem, 10),
      target: text.optional(),
      backupPath: text.optional(),
      nextAction: action.optional(),
    }),
  ],
  "migrate artifact-contract-v2": [
    receipt("cli-migrate-artifact-contract-v2-1", "成功", {
      mode: oneOf("check", "write"),
      migration: oneOf("memory-syntax", "artifact-contract-v2", "schema-contract-v2"),
      status: oneOf("ready", "blocked"),
      affectedFiles: integer,
      issueCount: integer,
      issues: list(publicMigrateSyntaxIssuesItem, 10),
      target: text.optional(),
      backupPath: text.optional(),
      nextAction: action.optional(),
    }),
  ],
  "migrate schema-contract-v2": [
    receipt("cli-migrate-schema-contract-v2-1", "成功", {
      mode: oneOf("check", "write"),
      migration: oneOf("memory-syntax", "artifact-contract-v2", "schema-contract-v2"),
      status: oneOf("ready", "blocked"),
      affectedFiles: integer,
      issueCount: integer,
      issues: list(publicMigrateSyntaxIssuesItem, 10),
      target: text.optional(),
      backupPath: text.optional(),
      nextAction: action.optional(),
    }),
  ],
};
