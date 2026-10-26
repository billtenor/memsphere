#!/usr/bin/env bash
cat > .memsphere/memory/procedures/eval-quick-procedure.yaml <<'YAML'
!procedure
syntax: memsphere-20260721-stable
names:
  - eval-quick-procedure
defines:
  - 用于在本评测中生成一条短的每周复盘提醒。
flow:
  - !action
    action: 写一条具体的每周复盘提醒。
    actor: agent
    artifact: !artifact
      name: 复盘提醒
      type: string
      format: { name: markdown }
      final: true
YAML
