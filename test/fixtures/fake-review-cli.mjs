#!/usr/bin/env node
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "tsx/esm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
await import(join(root, "src", "cli.ts"));
