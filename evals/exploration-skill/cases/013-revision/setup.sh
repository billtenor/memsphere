#!/usr/bin/env bash
set -euo pipefail
memsphere run start --name '每周复盘议程' --output json > run-receipt.json
run_id="$(node -e 'const fs=require("fs");process.stdout.write(JSON.parse(fs.readFileSync("run-receipt.json")).id)')"
printf '%s\n' "$run_id" > current-run.txt
cat > first-version.md <<'MD'
# 五人团队每周复盘议程

- 0–5 分钟：主持人说明上周目标，输出共同目标。
- 5–20 分钟：成员逐人分享进展与阻碍，输出问题清单。
- 20–30 分钟：讨论下周行动，输出行动项。
MD
memsphere run report --run "$run_id" --name '每周复盘议程初版' --artifact-file first-version.md --content-type text/markdown --output json > first-report.json
artifact_id="$(node -e 'const fs=require("fs");const r=JSON.parse(fs.readFileSync("first-report.json"));process.stdout.write(r.artifactId||r.artifact?.id||r.id||"")')"
[[ -n "$artifact_id" ]] || { cat first-report.json >&2; exit 1; }
printf '%s\n' "$artifact_id" > first-artifact.txt
memsphere run review create --run "$run_id" --artifact "$artifact_id" --reviewer human --comment '每个行动项请明确负责人。' --output json > feedback.json
