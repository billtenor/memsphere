#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: prepare-cases.sh [--output-root <dir>] <suite-id> [case-id ...]

Prepare a batch of agent-independent evaluation trials. When no case ID is
provided, every case in the suite is selected.

Options:
  --output-root <dir>  Parent directory for retained batches. Defaults to $TMPDIR or /tmp.
  -h, --help           Show this help.

The prepared batch path is written to stdout. Progress is written to stderr.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

output_root="${TMPDIR:-/tmp}"
positionals=()

while (($# > 0)); do
  case "$1" in
    --output-root)
      (($# >= 2)) || die "--output-root requires a directory"
      output_root="$2"
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
      positionals+=("$1")
      shift
      ;;
  esac
done

((${#positionals[@]} >= 1)) || {
  usage >&2
  exit 1
}

suite_id="${positionals[0]}"
[[ -n "$suite_id" && "$suite_id" != */* ]] || die "suite ID must be a single directory name"

evals_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
suite_dir="$evals_dir/$suite_id"
cases_dir="$suite_dir/cases"
[[ -d "$cases_dir" ]] || die "suite cases directory does not exist: $cases_dir"

case_ids=()
if ((${#positionals[@]} == 1)); then
  shopt -s nullglob
  discovered_cases=("$cases_dir"/*)
  shopt -u nullglob
  for case_dir in "${discovered_cases[@]}"; do
    [[ -d "$case_dir" ]] || continue
    case_ids+=("$(basename -- "$case_dir")")
  done
else
  case_ids=("${positionals[@]:1}")
fi

((${#case_ids[@]} > 0)) || die "no cases selected from suite: $suite_id"

declare -A selected=()
for case_id in "${case_ids[@]}"; do
  [[ -n "$case_id" && "$case_id" != */* ]] || die "case ID must be a single directory name: $case_id"
  [[ -z "${selected[$case_id]:-}" ]] || die "duplicate case ID: $case_id"
  selected["$case_id"]=1
  [[ -d "$cases_dir/$case_id" ]] || die "case directory does not exist: $cases_dir/$case_id"
done

mkdir -p -- "$output_root"
batch_dir="$(mktemp -d "$output_root/memsphere-eval-batch.${suite_id}.XXXXXX")"
trials_dir="$batch_dir/trials"
manifest_file="$batch_dir/trials.tsv"
metadata_file="$batch_dir/metadata.txt"
mkdir -p -- "$trials_dir" "$batch_dir/runs"
: >"$manifest_file"

for case_id in "${case_ids[@]}"; do
  trial_dir="$("$evals_dir/prepare-case.sh" --output-root "$trials_dir" "$suite_id/$case_id")"
  printf '%s\t%s\n' "$case_id" "$trial_dir" >>"$manifest_file"
done

{
  printf 'suite_id=%s\n' "$suite_id"
  printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'batch_dir=%s\n' "$batch_dir"
  printf 'case_count=%s\n' "${#case_ids[@]}"
  printf 'manifest=%s\n' "$manifest_file"
} >"$metadata_file"

printf 'Prepared evaluation batch with %s case(s): %s\n' "${#case_ids[@]}" "$batch_dir" >&2
printf '%s\n' "$batch_dir"
