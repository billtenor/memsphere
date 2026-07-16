#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: run-traex-agent.sh [--dry-run] [--model <model>] <prepared-trial-directory>

Run one clean TraeX child agent from a prepared evaluation trial baseline.

Options:
  --dry-run        Create the isolated run scope without launching TraeX.
  --model <model>  TraeX model used by the child agent. Defaults to TRAEX_MODEL or TraeX default.
  -h, --help       Show this help.

Environment:
  TRAEX_BIN        traex executable name or path. Defaults to traex.
  TRAEX_MODEL      default TraeX model when --model is omitted.
  MEMSPHERE_BIN    memsphere executable name or path. Defaults to memsphere.

The agent run path is written to stdout. Progress is written to stderr.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

dry_run=false
traex_model="${TRAEX_MODEL:-}"
trial_input=""

while (($# > 0)); do
  case "$1" in
    --dry-run)
      dry_run=true
      shift
      ;;
    --model)
      (($# >= 2)) || die "--model requires a model name"
      traex_model="$2"
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

traex_command="${TRAEX_BIN:-traex}"
traex_bin="$(command -v -- "$traex_command" || true)"
[[ -n "$traex_bin" ]] || die "traex executable not found: $traex_command"

memsphere_command="${MEMSPHERE_BIN:-memsphere}"
memsphere_bin="$(command -v -- "$memsphere_command" || true)"
[[ -n "$memsphere_bin" ]] || die "memsphere executable not found: $memsphere_command"
memsphere_bin="$(cd -- "$(dirname -- "$memsphere_bin")" && pwd)/$(basename -- "$memsphere_bin")"

mkdir -p -- "$trial_dir/runs"
run_dir="$(mktemp -d "$trial_dir/runs/traex.XXXXXX")"
workspace_dir="$run_dir/workspace"
home_dir="$run_dir/home"
bin_dir="$home_dir/go/bin"
events_file="$run_dir/agent-events.jsonl"
stderr_file="$run_dir/agent-stderr.log"
answer_file="$run_dir/final-answer.md"
metadata_file="$run_dir/metadata.txt"

mkdir -p -- "$workspace_dir" "$home_dir" "$bin_dir"
cp -a -- "$baseline_workspace/." "$workspace_dir/"
ln -s -- "$memsphere_bin" "$bin_dir/memsphere"

{
  printf 'agent=traex\n'
  printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'dry_run=%s\n' "$dry_run"
  printf 'trial_dir=%s\n' "$trial_dir"
  printf 'run_dir=%s\n' "$run_dir"
  printf 'scope=%s\n' "$trial_dir"
  printf 'workspace=%s\n' "$workspace_dir"
  printf 'traex_bin=%s\n' "$traex_bin"
  printf 'traex_version=%s\n' "$("$traex_bin" --version)"
  printf 'traex_model=%s\n' "${traex_model:-default}"
  printf 'memsphere_bin=%s\n' "$memsphere_bin"
  printf 'memsphere_version=%s\n' "$("$memsphere_bin" --version)"
} >"$metadata_file"

if $dry_run; then
  printf 'Prepared TraeX dry run: %s\n' "$run_dir" >&2
  printf '%s\n' "$run_dir"
  exit 0
fi

original_home="${HOME:-}"
trae_home="${TRAE_HOME:-${original_home:+$original_home/.trae}}"
traex_args=(
  exec
  --cd "$workspace_dir"
  --sandbox workspace-write
  --ephemeral
  --ignore-user-config
  --ignore-rules
  --json
  --output-last-message "$answer_file"
)
if [[ -n "$traex_model" ]]; then
  traex_args+=(--model "$traex_model")
fi

set +e
HOME="$home_dir" TRAE_HOME="$trae_home" PATH="$bin_dir:$PATH" \
  env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
  "$traex_bin" "${traex_args[@]}" - <"$prompt_file" >"$events_file" 2>"$stderr_file"
traex_status=$?
set -e

printf 'traex_exit_code=%s\n' "$traex_status" >>"$metadata_file"
printf 'Completed TraeX run with exit code %s: %s\n' "$traex_status" "$run_dir" >&2
printf '%s\n' "$run_dir"

exit "$traex_status"
