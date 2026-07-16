#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: prepare-case.sh [--output-root <dir>] <suite-id/case-id-or-directory>

Prepare an agent-independent memsphere self-bootstrap evaluation trial.

Options:
  --output-root <dir>  Parent directory for retained trials. Defaults to $TMPDIR or /tmp.
  -h, --help           Show this help.

Environment:
  MEMSPHERE_BIN        memsphere executable name or path. Defaults to memsphere.

The prepared trial path is written to stdout. Progress is written to stderr.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

output_root="${TMPDIR:-/tmp}"
case_input=""

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
      [[ -z "$case_input" ]] || die "only one case may be prepared at a time"
      case_input="$1"
      shift
      ;;
  esac
done

[[ -n "$case_input" ]] || {
  usage >&2
  exit 1
}

evals_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ -d "$case_input" ]]; then
  case_dir="$(cd -- "$case_input" && pwd)"
  cases_dir="$(dirname -- "$case_dir")"
  [[ "$(basename -- "$cases_dir")" == "cases" ]] || die "case directory must be located under a suite's cases directory"
  suite_dir="$(dirname -- "$cases_dir")"
  suite_id="$(basename -- "$suite_dir")"
else
  [[ "$case_input" == */* ]] || die "case selector must use <suite-id>/<case-id>"
  suite_id="${case_input%%/*}"
  case_id_input="${case_input#*/}"
  [[ -n "$suite_id" && -n "$case_id_input" && "$case_id_input" != */* ]] || die "case selector must use <suite-id>/<case-id>"
  case_dir="$evals_dir/$suite_id/cases/$case_id_input"
fi

[[ -d "$case_dir" ]] || die "case directory does not exist: $case_dir"

task_file="$case_dir/task.md"
evaluation_file="$case_dir/evaluation.md"
fixtures_dir="$case_dir/fixtures"

[[ -f "$task_file" ]] || die "case task does not exist: $task_file"
[[ -f "$evaluation_file" ]] || die "case evaluation guide does not exist: $evaluation_file"

memsphere_command="${MEMSPHERE_BIN:-memsphere}"
memsphere_bin="$(command -v -- "$memsphere_command" || true)"
[[ -n "$memsphere_bin" ]] || die "memsphere executable not found: $memsphere_command"

case_id="$(basename -- "$case_dir")"
mkdir -p -- "$output_root"
trial_dir="$(mktemp -d "$output_root/memsphere-eval.${suite_id}.${case_id}.XXXXXX")"
baseline_dir="$trial_dir/baseline"
workspace_dir="$baseline_dir/workspace"
setup_home="$trial_dir/setup-home"
prompt_file="$trial_dir/prompt.md"
setup_log="$trial_dir/setup.log"
metadata_file="$trial_dir/metadata.txt"

mkdir -p -- "$workspace_dir" "$setup_home" "$trial_dir/runs"
HOME="$setup_home" git -C "$workspace_dir" init -q

if [[ -d "$fixtures_dir" ]]; then
  cp -a -- "$fixtures_dir/." "$workspace_dir/"
fi

HOME="$setup_home" "$memsphere_bin" init --folder "$workspace_dir" >"$setup_log" 2>&1
HOME="$setup_home" "$memsphere_bin" skill init --directory "$workspace_dir/.agents/skills" >>"$setup_log" 2>&1

cat >"$prompt_file" <<'EOF'
# 验收环境

当前工作目录是本次任务的完整工程根目录。只允许访问当前工程内的文件；不得访问父目录、其他工程、用户主目录，也不得通过绝对路径访问工程外文件。

---

EOF
cat -- "$task_file" >>"$prompt_file"

{
  printf 'suite_id=%s\n' "$suite_id"
  printf 'case_id=%s\n' "$case_id"
  printf 'created_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'isolation_level=soft\n'
  printf 'trial_dir=%s\n' "$trial_dir"
  printf 'baseline_workspace=%s\n' "$workspace_dir"
  printf 'evaluation_file=%s\n' "$evaluation_file"
  printf 'memsphere_bin=%s\n' "$memsphere_bin"
  printf 'memsphere_version=%s\n' "$("$memsphere_bin" --version)"
  printf 'memsphere_skill=memsphere\n'
} >"$metadata_file"

printf 'Prepared evaluation trial: %s\n' "$trial_dir" >&2
printf 'Baseline workspace: %s\n' "$workspace_dir" >&2
printf 'Prompt: %s\n' "$prompt_file" >&2
printf '%s\n' "$trial_dir"
