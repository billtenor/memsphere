#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: run-cases.sh --agent <codex|traex> [--dry-run] [--model <model>] <prepared-batch-directory>

Run every selected trial in a prepared batch concurrently. Each case still
uses a separate child agent, workspace, and HOME.

Options:
  --agent <agent>  Agent runner to use: codex or traex.
  --dry-run        Prepare each isolated Agent run without launching the Agent.
  --model <model>  Model passed to the selected Agent runner.
  -h, --help       Show this help.

The batch run path is written to stdout after all cases finish. Progress and
the path available while the batch is running are written to stderr.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

agent=""
dry_run=false
model=""
batch_input=""

while (($# > 0)); do
  case "$1" in
    --agent)
      (($# >= 2)) || die "--agent requires an agent name"
      agent="$2"
      shift 2
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    --model)
      (($# >= 2)) || die "--model requires a model name"
      model="$2"
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
      [[ -z "$batch_input" ]] || die "only one prepared batch may be run at a time"
      batch_input="$1"
      shift
      ;;
  esac
done

[[ -n "$agent" ]] || die "--agent is required"
[[ -n "$batch_input" ]] || {
  usage >&2
  exit 1
}
[[ -d "$batch_input" ]] || die "prepared batch directory does not exist: $batch_input"

batch_dir="$(cd -- "$batch_input" && pwd)"
manifest_file="$batch_dir/trials.tsv"
[[ -f "$manifest_file" ]] || die "prepared batch manifest does not exist: $manifest_file"

evals_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
case "$agent" in
  codex)
    runner="$evals_dir/run-codex-agent.sh"
    ;;
  traex)
    runner="$evals_dir/run-traex-agent.sh"
    ;;
  *)
    die "unsupported agent: $agent"
    ;;
esac

case_ids=()
trial_dirs=()
while IFS=$'\t' read -r case_id trial_dir; do
  [[ -n "$case_id" && -n "$trial_dir" ]] || die "invalid batch manifest entry"
  [[ -d "$trial_dir" ]] || die "prepared trial directory does not exist: $trial_dir"
  case_ids+=("$case_id")
  trial_dirs+=("$trial_dir")
done <"$manifest_file"

((${#case_ids[@]} > 0)) || die "prepared batch contains no trials"

mkdir -p -- "$batch_dir/runs"
batch_run_dir="$(mktemp -d "$batch_dir/runs/${agent}.XXXXXX")"
logs_dir="$batch_run_dir/logs"
status_dir="$batch_run_dir/status"
partial_results_dir="$batch_run_dir/results"
results_file="$batch_run_dir/results.tsv"
metadata_file="$batch_run_dir/metadata.txt"
mkdir -p -- "$logs_dir" "$status_dir" "$partial_results_dir"

{
  printf 'agent=%s\n' "$agent"
  printf 'model=%s\n' "${model:-default}"
  printf 'dry_run=%s\n' "$dry_run"
  printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'batch_dir=%s\n' "$batch_dir"
  printf 'batch_run_dir=%s\n' "$batch_run_dir"
  printf 'case_count=%s\n' "${#case_ids[@]}"
} >"$metadata_file"

runner_args=()
$dry_run && runner_args+=(--dry-run)
[[ -z "$model" ]] || runner_args+=(--model "$model")

printf 'Batch run directory: %s\n' "$batch_run_dir" >&2
printf 'Launching %s case(s) concurrently with %s.\n' "${#case_ids[@]}" "$agent" >&2

pids=()
result_files=()
for index in "${!case_ids[@]}"; do
  case_id="${case_ids[$index]}"
  trial_dir="${trial_dirs[$index]}"
  log_file="$logs_dir/$case_id.log"
  status_file="$status_dir/$case_id.status"
  result_file="$partial_results_dir/$case_id.tsv"
  result_files+=("$result_file")

  printf 'state=running\ncase_id=%s\ntrial_dir=%s\n' "$case_id" "$trial_dir" >"$status_file"
  (
    set +e
    run_output="$("$runner" "${runner_args[@]}" "$trial_dir" 2>"$log_file")"
    exit_code=$?
    run_dir="${run_output##*$'\n'}"
    state="completed"
    [[ "$exit_code" -eq 0 ]] || state="failed"
    printf '%s\t%s\t%s\t%s\n' "$case_id" "$trial_dir" "$run_dir" "$exit_code" >"$result_file"
    printf 'state=%s\ncase_id=%s\ntrial_dir=%s\nrun_dir=%s\nexit_code=%s\n' \
      "$state" "$case_id" "$trial_dir" "$run_dir" "$exit_code" >"$status_file"
  ) &
  pids+=("$!")
  printf 'Started %s (pid %s); status: %s\n' "$case_id" "${pids[-1]}" "$status_file" >&2
done

for pid in "${pids[@]}"; do
  wait "$pid"
done

printf 'case_id\ttrial_dir\trun_dir\texit_code\n' >"$results_file"
overall_status=0
for index in "${!result_files[@]}"; do
  result_file="${result_files[$index]}"
  [[ -f "$result_file" ]] || die "case runner did not produce a result: ${case_ids[$index]}"
  result_line="$(<"$result_file")"
  printf '%s\n' "$result_line" >>"$results_file"
  IFS=$'\t' read -r case_id trial_dir run_dir exit_code <<<"$result_line"
  printf 'Finished %s with exit code %s: %s\n' "$case_id" "$exit_code" "$run_dir" >&2
  [[ "$exit_code" -eq 0 ]] || overall_status=1
done

printf 'finished_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$metadata_file"
printf 'overall_exit_code=%s\n' "$overall_status" >>"$metadata_file"
printf 'Batch results: %s\n' "$results_file" >&2
printf '%s\n' "$batch_run_dir"

exit "$overall_status"
