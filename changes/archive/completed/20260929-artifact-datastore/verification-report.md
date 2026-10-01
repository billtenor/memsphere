# Run 附属数据接入：初始验证报告

Run：run-20260929-121744z-d56a5df3；基线 820530e。本轮按 statements/memsphere-repository-testing-rules 执行实际验证；stable Tag 使用 Human 已批准的本轮例外，不创建 Tag。

## 实际命令与结果

- npm run typecheck：通过。
- npm run build：通过。
- git diff --check：通过。
- 已安装 memsphere validate：当前 Project Store 通过。
- memsphere memory change validate：change-20260930-092656432z-e44618d2 校验通过，digest 9fc3756490040e59a3e3b4199b55472db245c1b68cc6672dfc197fa6cadb0164。六份 System Memory 源与开发 Project 副本 cmp 全部相同。
- 沙箱外实际执行受影响套件 run-data-access、run-memory-backfill、archive-run-data、archive-store、archive-worker-guard、reserved-store、run-command、run-changeset：82 项通过、0 失败。其后补充不透明 Store 的 Schema export/edit/report 测试，run-data-access 9 项通过。
- 首轮全部代码的全量 npm test -- --test-reporter=spec：709 项，708 通过、0 失败、1 平台跳过。新增 opaque Schema 回归后的最终全量再次实际通过：710 项，709 通过、0 失败、1 Windows 专属跳过，37.23 秒。没有降低或跳过本轮断言。
- 新构建 node dist/cli.js run artifact export --help：通过，提供 --run、--step、--file、--force，无历史选择参数。
- 新构建 node dist/cli.js validate --memory-root .memsphere/memory：四类 Memory 无状态校验通过，不替代 Project 或 ChangeSet 校验。
- 新构建 CLI 在独立临时 Home 中创建 Managed Project，然后 validate：通过；临时目录已清理，真实 Home/Project 不变。

## 验收标准证据

1. 内容抽象及隔离：Project host 复用同一 Manager、不同 Project 隔离，四模型八 Store 单独绑定；真实 filesystem JSONL 原字节、后缀与原目录映射测试通过。不透明 Store 无本地内容路径，list 被测试 helper 禁止，Run 快照、Artifact report/export、Schema 合成和搬运仍能执行。
2. Artifact 交互：既有 run-store/run-command/review 回归保护内容、摘要、冻结与权限；新的 opaque Schema 测试实际执行中间产物导出、编辑副本、非法上报保留填写进度、合法副本最终接纳，导出不改变持久化状态，最终导出包含编辑内容。默认覆盖拒绝、force 不修改硬链接冻结文件、托管路径拒绝有测试。
3. Memory 清单：非 canonical 文件名、四类实体、嵌套资源身份、重复/越界清单与缺失清单提示；Managed 与 Embedded ChangeSet 冻结读取原逻辑内容。独立工具 default check 不写、--write 只补缺失字段、重复不改、来源内容不动、缺目录/符号链接失败保留状态。Git 占位在新快照与补齐中排除，源文件不删除。
4. 日志失败语义：原活动过滤与截断测试通过。有限 append 故障分别覆盖零写入、完整行前缀、半行、损坏完整行；快照只展示保存事件、不出现失败 ghost，错误回调一次，不重放或修复日志，Agent 执行不因日志失败停止。
5. 搬运及 redo：不透明 Store 验证复制失败保留源、部分目标重跑覆盖、状态提交后清理失败只续删不回写、元信息/原生状态失败旧式布局仍可重试。恢复未知文件清理失败保留文件，归档列表不显示已恢复 Run，再次 restore 不从旧端残留反向覆盖。旧 Memory .gitkeep 清理不再阻断完成，其他未知文件仍受保护。
6. 可选活动与 PID：五类 Attempt 状态各测试两类资源均无、仅日志、仅快照、两者都有，共 20 条归档/恢复测试；实际 I/O 错误不得当不存在，已发现资源在验证前消失不得切换。PID alive/reuse、ESRCH、EPERM、未知错误、无 PID、重试重新探测有确定性测试，不等待真实 PID 时序，不终止 Worker。
7. 前端/命令/包兼容：全量包含真实浏览器驱动 View/Review 集成及 CLI/子进程/Git 测试；本轮没有修改前端交互组件，因此未另行调用 playwright-cli 人工操作。package-release/reserved-store 验证独立工具入包及 System Memory 安装链，默认现有配置无新字段。

## 失败分类与处理

- 本轮已修复：旧精确断言未包含 memorySnapshot.files、提示仍期望直接编辑托管草稿、包文件断言未纳入独立工具；均更新为当前确认契约，不删除或跳过测试。临时新测试的内存对象/持久化对象 undefined 差异改为比较操作前后的真实持久化状态。相应测试全部复跑通过。
- 本轮实际兼容问题已按 Human 决策修复：旧目录复制带入 .gitkeep。Human 确认可丢弃，排除占位而不扩展 Store、不过滤其他内容；新快照、补齐和旧端归档清理有回归。没有运行真实历史补齐或批量迁移。
- 既有环境差异：新构建 CLI 在真实 Home 直接 validate 被较新全局配置字段 operator_token、view_packages、view_theme、view_composition 拒绝。globalConfigSchema 与 820530e 完全相同，安装 CLI 则支持该配置。未修改全局配置或把隔离成功描述成此项成功。此差异与 Run 接入无关，列为当前机器的直接运行限制。
- 早期未完成的 run-command 诊断不作为通过证据；停止的仅是本轮诊断进程，后来完整套件已实际通过。

## 未验证与残余边界

当前系统 Linux；Windows/macOS 未实测，Windows 专属测试按条件跳过，跨平台 API/路径处理与现有 CI 不等于实测。没有实际 OSS/云后端，不承诺云端追加一致性；不新增跨 Store 事务。原状态 rename 跨卷错误维持原失败边界，不新增状态复制协议。Worker PID 复用可能保守误拦，按确认策略重试。未实施真实历史 Record 修改。

尚未取得实现 Review、Human 最终验收、commit 或 PR，不声明已交付。

Memory ChangeSet View：http://0.0.0.0:30000/projects/memsphere/changes/change-20260930-092656432z-e44618d2 。状态 validation passed / active；没有 publish 或 commit。
# 2026-10-01 提交前复验补记

Human 试用后正式验收通过。提交前重新运行 `npm run typecheck`、`npm test -- --test-reporter=spec`：710 项，709 通过、0 失败、1 Windows 专属跳过（约 37 秒）。Project `memsphere validate` 和 `memsphere memory change validate` 均通过，后者仍为 change-20260930-092656432z-e44618d2、digest 9fc3756490040e59a3e3b4199b55472db245c1b68cc6672dfc197fa6cadb0164，与已评审内容相同。试用阶段另存为相关 9 项复验全部通过；试用不是新增正式业务数据或升级真实安装。
