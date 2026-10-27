#!/usr/bin/env bash
set -euo pipefail
trial="${1:?Usage: run-codex.sh <prepared-trial> [--dry-run]}"
workspace="$(cd -- "$trial/workspace" && pwd)"
[[ -f "$trial/prompt.md" ]] || { echo 'Prepared trial lacks prompt.md' >&2; exit 1; }
run_dir="$(mktemp -d "$trial/evidence/codex.XXXXXX")"
printf 'run_dir=%s\n' "$run_dir" > "$run_dir/metadata.txt"
if [[ "${2:-}" == '--dry-run' ]]; then printf '%s\n' "$run_dir"; exit 0; fi
export MEMSPHERE_HOME="$workspace/.memsphere-home"
export PATH="$workspace/.bin:$PATH"
set +e
codex exec --cd "$workspace" --sandbox workspace-write --ephemeral --ignore-user-config --ignore-rules --json --output-last-message "$run_dir/final.md" - < "$trial/prompt.md" > "$run_dir/events.jsonl" 2> "$run_dir/stderr.log"
status=$?
set -e
printf 'exit=%s\n' "$status" >> "$run_dir/metadata.txt"
printf '%s\n' "$run_dir"
exit "$status"
