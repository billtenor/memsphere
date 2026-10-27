#!/usr/bin/env bash
set -euo pipefail
case_id="${1:?Usage: prepare.sh <case-id> [output-root]}"
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
case_dir="$repo_root/evals/exploration-skill/cases/$case_id"
[[ -f "$case_dir/task.md" ]] || { echo "Unknown case: $case_id" >&2; exit 1; }
output_root="${2:-${TMPDIR:-/tmp}}"
mkdir -p "$output_root"
trial="$(mktemp -d "$output_root/memsphere-exploration.$case_id.XXXXXX")"
workspace="$trial/workspace"
mkdir -p "$workspace/.bin" "$workspace/.memsphere/memory" "$trial/evidence"
git -C "$workspace" init -q -b master
git -C "$workspace" config user.name 'Memsphere Eval'
git -C "$workspace" config user.email 'eval@example.invalid'
ln -s "$repo_root/dist/cli.js" "$workspace/.bin/memsphere"
export MEMSPHERE_HOME="$workspace/.memsphere-home"
export PATH="$workspace/.bin:$PATH"
(cd "$workspace" && memsphere project create "eval-${case_id%%-*}" --embedded .memsphere/memory --bind > "$trial/evidence/project-create.log")
memsphere skill init --directory "$workspace/.agents/skills" > "$trial/evidence/skill-install.log"
if [[ -f "$case_dir/setup.sh" ]]; then (cd "$workspace" && bash "$case_dir/setup.sh" "$repo_root" > "$trial/evidence/setup.log"); fi
{
  echo 'Use the installed .agents/skills/memsphere/SKILL.md and the local CLI at .bin/memsphere to complete this task.'
  echo 'Work only in this isolated workspace. Do not read evaluation.md.'
  echo
  cat "$case_dir/task.md"
} > "$trial/prompt.md"
printf 'case=%s\nworkspace=%s\nmemsphere_home=%s\ncli=%s\n' "$case_id" "$workspace" "$MEMSPHERE_HOME" "$repo_root/dist/cli.js" > "$trial/evidence/metadata.txt"
printf '%s\n' "$trial"
