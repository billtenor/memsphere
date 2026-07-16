#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: run-codex-agent.sh [--dry-run] [--model <model>] <prepared-trial-directory>

Run one clean Codex child agent from a prepared evaluation trial baseline.

Options:
  --dry-run        Create the isolated run scope without launching Codex.
  --model <model>  Codex model used by the child agent. Defaults to CODEX_MODEL or Codex default.
  -h, --help       Show this help.

Environment:
  CODEX_BIN        codex executable name or path. Defaults to codex.
  CODEX_MODEL      default Codex model when --model is omitted.

The agent run path is written to stdout. Progress is written to stderr.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

dry_run=false
codex_model="${CODEX_MODEL:-}"
trial_input=""

while (($# > 0)); do
  case "$1" in
    --dry-run)
      dry_run=true
      shift
      ;;
    --model)
      (($# >= 2)) || die "--model requires a model name"
      codex_model="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      die "unknown option: $1"
      ;;
    *)
      [[ -z "$trial_input" ]] || die "only one prepared trial may be run at a time"
      trial_input="$1"
      shift
      ;;
  esac
done

[[ -n "$trial_input" ]] || {
  usage >&2
  exit 1
}

[[ -d "$trial_input" ]] || die "prepared trial directory does not exist: $trial_input"
trial_dir="$(cd -- "$trial_input" && pwd)"
baseline_workspace="$trial_dir/baseline/workspace"
prompt_file="$trial_dir/prompt.md"

[[ -d "$trial_dir/.memsphere" ]] || die "trial memsphere scope does not exist: $trial_dir/.memsphere"
[[ -d "$baseline_workspace" ]] || die "baseline workspace does not exist: $baseline_workspace"
[[ -f "$prompt_file" ]] || die "prepared prompt does not exist: $prompt_file"

codex_command="${CODEX_BIN:-codex}"
codex_bin="$(command -v -- "$codex_command" || true)"
[[ -n "$codex_bin" ]] || die "codex executable not found: $codex_command"

mkdir -p -- "$trial_dir/runs"
run_dir="$(mktemp -d "$trial_dir/runs/codex.XXXXXX")"
workspace_dir="$run_dir/workspace"
home_dir="$run_dir/home"
events_file="$run_dir/agent-events.jsonl"
stderr_file="$run_dir/agent-stderr.log"
answer_file="$run_dir/final-answer.md"
metadata_file="$run_dir/metadata.txt"

mkdir -p -- "$workspace_dir" "$home_dir"
cp -a -- "$baseline_workspace/." "$workspace_dir/"

{
  printf 'agent=codex\n'
  printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'dry_run=%s\n' "$dry_run"
  printf 'trial_dir=%s\n' "$trial_dir"
  printf 'run_dir=%s\n' "$run_dir"
  printf 'scope=%s\n' "$trial_dir"
  printf 'workspace=%s\n' "$workspace_dir"
  printf 'codex_bin=%s\n' "$codex_bin"
  printf 'codex_version=%s\n' "$("$codex_bin" --version)"
  printf 'codex_model=%s\n' "${codex_model:-default}"
} >"$metadata_file"

if $dry_run; then
  printf 'Prepared Codex dry run: %s\n' "$run_dir" >&2
  printf '%s\n' "$run_dir"
  exit 0
fi

original_home="${HOME:-}"
codex_home="${CODEX_HOME:-${original_home:+$original_home/.codex}}"
codex_args=(
  exec
  --cd "$workspace_dir"
  --sandbox workspace-write
  --ephemeral
  --ignore-user-config
  --ignore-rules
  --json
  --output-last-message "$answer_file"
)
if [[ -n "$codex_model" ]]; then
  codex_args+=(--model "$codex_model")
fi

set +e
HOME="$home_dir" CODEX_HOME="$codex_home" "$codex_bin" "${codex_args[@]}" \
  - <"$prompt_file" >"$events_file" 2>"$stderr_file"
codex_status=$?
set -e

printf 'codex_exit_code=%s\n' "$codex_status" >>"$metadata_file"
printf 'Completed Codex run with exit code %s: %s\n' "$codex_status" "$run_dir" >&2
printf '%s\n' "$run_dir"

exit "$codex_status"
