import { basename } from "node:path";

/** Longest-first scheduling keeps shards balanced; new files are always included. */
export function partitionTests(files, durations, count) {
  if (!Number.isInteger(count) || count < 1) throw new Error("Shard count must be a positive integer");
  const groups = Array.from({ length: count }, () => ({ files: [], seconds: 0 }));
  const weight = file => durations[basename(file)] ?? 2;
  for (const file of [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b, "en"))) {
    const group = groups.reduce((best, candidate) => candidate.seconds < best.seconds ? candidate : best);
    group.files.push(file);
    group.seconds += weight(file);
  }
  return groups;
}
