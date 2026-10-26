#!/usr/bin/env bash
cat > .memsphere/memory/concepts/team-event.yaml <<'YAML'
!concept
syntax: memsphere-20260721-stable
names: [team-event, 事件]
defines:
  - 本项目的事件是团队会议中一个带开始时间、责任人和结果的工作事项，不是系统日志事件。
YAML
cat > .memsphere/memory/statements/team-event-rules.yaml <<'YAML'
!statement
syntax: memsphere-20260721-stable
names: [team-event-rules]
defines:
  - 规定团队事件说明的边界。
asserts:
  - 说明事件时必须区分计划时间与实际发生时间。
YAML
cat > .memsphere/memory/schemas/team-event-schema.yaml <<'YAML'
!schema
syntax: memsphere-20260721-stable
names: [team-event-schema]
format: { name: markdown, layout: outline }
defines:
  - 定义团队事件说明的文本结构。
fields:
  - !schema
    name: 事件名称
    type: string
  - !schema
    name: 责任人
    type: string
YAML
