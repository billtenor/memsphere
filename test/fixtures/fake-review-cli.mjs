#!/usr/bin/env node
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
await import(pathToFileURL(join(root, "dist", "cli.js")).href);
