# 模型与数据 CLI：开发计划

日期：2026-10-05（Asia/Shanghai）。Run：run-20261003-090655z-f1e492f6。
依据：第八轮需求已通过；实施方案第二轮 submission-20261005-021129z-820666e3 已通过，SHA-256 cddc81883d393e375bee3aef3a14ad87cdccccb46c24e558be89c4e7c7f250f8。测试 Agent 意见 comment-20261005-021401z-f192b375 已接受，以下 D2/D4/D8 明确落实。批准记录见 review/implementation-round-2-runner-decision.md。

本计划制定时所有实施任务尚未完成；准备阶段探针不算实现测试。任务进度与实际验证在 change.md、实现摘要和验证报告更新。

## 执行顺序与任务

| 任务 | 交付内容 | 前置 | 完成判据与验证 |
| --- | --- | --- | --- |
| D0 恢复开发环境 | 依锁文件安装依赖，保存基线 typecheck；不把缺少 tsc/tsx 当作产品失败 | 无 | 工具能启动；环境、基线失败与本轮失败分别记录 |
| D1 统一身份和检查 | .json 模型/元模型 ID，固定物理目录与 Run Store 地址；本地 Schema 引用检查；资源 06 及全部实际副本修正；统一完整 Runtime 准入与错误分类 | D0 | A1–A5、A17–A24；系统/raw 可用，不支持 Schema 明确拒绝；数据中的 $ref 不误报；正向 fixture 合规 |
| D2 文件锁和恢复 | Project 写锁、filesystem JSON ValueStore 记录锁；模型操作记录、阶段和只读快照；实际模型写请求先恢复再装配及预检 | D1 清单 | 独立进程互斥/SIGKILL；模型各阶段中断及再次中断、后来修改冲突；原命令重试，无隐式初始化；只读与 dry-run 零写 |
| D3 模型服务 | 查询/CRUD/validate；管理字段约束、来源权限、直接 Store 绑定保护；保存字节；安装/导入/恢复复用准入与一致提交 | D1、D2 | A1–A5、A19–A24；系统全字段拒写；无半提交，市场索引同步；空 Store 也保护 |
| D4 Store 与数据服务 | dataStores 配置完整读写、纯 openExisting、路径与文件协议校验；CRUD/has/validate/export/CAS；删除版本保留 | D2、D3 | A6–A7、A9–A14、A23；目录别名与系统区域拒绝；解除后重新绑定不重置版本；Payload 保真；独立进程 create/create、create/delete 与删除重建 |
| D5 新 CLI 和路径模块 | 命令参数/互斥/stdin/输出；JSONPath 标准查询；JSON Patch 六操作、最终一次校验与条件提交 | D3、D4，纯模块可并行 | A8、A11–A13、A21；JSON 双流/退出码含解析错误；特殊键/根/数组/中间态；edit 不部分保存 |
| D6 全量 list 分页 | 公共游标，model/data/store/project/memory/archive 六个 list；Memory 子节点/冻结 Run/Reviewer；统一 items/nextCursor 和调用方 | 输出模块，其他模块可并行 | A25；默认/边界 limit、筛选后分页、scope 错误、可变 limit、空/末页、稳定内容无重复遗漏 |
| D7 文档、Memory 和实际清理 | 双语 README、帮助、设计文档、依赖通知、Framework/访问规则/Skill/模板；隔离验证后修正当前实际 Project | D1–D6 稳定 | Memory 源与副本一致，reserved-store/变更级校验；全量标准审查与原数据/冻结摘要保留；真实修正有前后证据 |
| D8 完整验证和交付材料 | 受影响测试、真实 CLI/并发/故障；四项门槛、平台 CI/安装冒烟；实现摘要与初始报告及验收映射 | 按任务执行，最后全量 | A1–A25 无降级；记录实际执行结果与未验证平台；最终 Memory ChangeSet ID/status/View；View 交互受影响时真实浏览器验证 |

新增文件和现有文件分工以实施方案为准。公共 src/cli.ts、src/project/model.ts、src/persistence.ts 统一集成；独立模块可由辅助 Agent 实施，不并发编辑同一文件。正式流程 Reviewer 始终独立评审实际成果。

## 测试 Agent 补充的具体用例

纳入 D2/D4 的实现测试与 D8 验收，全部使用独立 Node/CLI 进程、IPC 或文件屏障：

1. 同 ID create/create：空 Store 中两个进程竞争；恰一成功，另一方报告已存在；记录可完整解码。
2. 同 ID create/delete：分别从不存在和已存在记录开始，控制两种持锁顺序；成功、缺失和已存在回执与最终记录状态一致，不出现半条 JSON。
3. delete 后立即 create：重建 revision 严格高于删除前，持旧 revision 的 update/delete 明确拒绝；包含 CLI 与直接 Factory 混合调用。
4. 与方案已有 update/update、update/delete、delete/delete、edit/edit 共同验证全部写入口采用相同协调。不能用同 realm Promise.allSettled 或固定睡眠替代。

## 验证与流程推进

每个任务先运行相关模块/集成测试并解决失败；真实 CLI 先构建，用隔离 Home/Project。最终运行并保存 npm run typecheck、npm test、npm run build、memsphere validate，Memory 修改另执行 memsphere memory change validate。平台未运行如实列出，不能用上游证明代替。不得先修改真实 Project 再用它代替隔离故障测试。

完成开发后按 Run 返回步骤上报功能实现摘要、初始验证报告、实现与验证验收材料，再经过研发/测试/架构（含 Human）评审和产品交付评审。没有实际成果前不报告通过、不提交实现验收；范围或方案改变先取得同等确认。
