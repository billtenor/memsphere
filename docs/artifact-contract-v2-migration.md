# Artifact Contract v2 升级指南

Artifact Contract v2 把旧 format 的多重职责拆为 `type -> format -> schema`，属于不兼容升级。

## 写法变化

| v1 | v2 |
| --- | --- |
| format: boolean | type: boolean，省略 format |
| format: number | type: number，省略 format |
| format: string | type: string，省略 format |
| format: markdown | type: string + format: markdown |
| format: json/yaml | 必须人工选择 type: object 或 array |
| format: schema + outline | type: object + markdown layout: outline + schema |
| format: schema + table | type: array + markdown layout: table + schema |

Schema 的 format 字段被移除。inline Schema 的旧 layout 上移到 Artifact format；external Schema 由迁移器分析全部消费者，在唯一解析且契约一致时安全上移。

## 升级步骤

1. 停止 View 和新的 Run/Review 写入。
2. 完成、归档或放弃 running v1 Run。
3. 备份 config 指向的 memoryRoot、runsRoot、reviewsRoot 和 archiveRoot。
4. 执行只读检查：

```bash
memsphere migrate artifact-contract-v2 --check
```

5. 人工解决 json/yaml type 歧义、缺失/冲突 external Schema 和孤立旧 layout。
6. 明确确认后执行：

```bash
memsphere migrate artifact-contract-v2 --write
```

7. 运行 validate、测试和 smoke，再恢复 View。

迁移器由 config 定位目录，不调用 Git。write 使用锁、staged root、备份、SHA-256 manifest、临时文件 rename 和失败恢复；重复 check/write 必须幂等。

## 历史数据

- running v1 Run 不允许跨版本 report、enter-schema 或 repeat。
- done/archived v1 Run、Review snapshot 和历史 `.schema.md` 文件不重写。
- View 通过只读 adapter 展示 v1 证据。
- 新 Run 和 Review 只写 v2 snapshot。

真实用户 Memory 默认只执行 check。没有 human 明确确认时，不执行 write。
