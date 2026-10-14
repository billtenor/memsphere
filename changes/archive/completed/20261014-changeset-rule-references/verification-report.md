# 初始验证报告（本 Run 最终实现）

## 结论

当前代码满足需求契约验收 1–6、8。产品需求和方案均经 Agent 评审接纳；实现成果评审和 Human 最终需求验收仍待完成。未发布到正在运行的 View。

## 实际执行

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| `node --import tsx --test test/view-responsive.test.ts test/memory-changeset.test.ts` | 31/31 通过 | evidence/affected-tests.txt |
| `npm run typecheck` | 通过，两个 TS project | evidence/typecheck.txt |
| `npm run build` | 通过，保留模型及 View 构建门禁 | evidence/build.txt；全量 npm test pretest 再次构建通过 |
| `npm test` | 146/146 文件，0 失败 | evidence/full-tests.txt，第二轮最终 elapsed 351.00s |
| `memsphere validate` | 当前 Project Store 通过 | evidence/store-validation.txt |
| `git diff --check` | 通过 | 实际执行，无输出 |
| playwright-cli 实际操作 | 合法未修改引用不标 missing；展开/收起/跳转；等待目标正文加载，全部通过 | evidence/browser-and-lifecycle.txt |
| 重复 detail 请求与堆快照 | 12 次请求后 GC，保留的 disposable preview 路径为 0 | evidence/browser-and-lifecycle.txt |
| 保存的生命周期验证器复跑 | 通过，临时脚本/快照清理，12 次请求无保留 preview 路径 | evidence/reproduce-lifecycle.mjs；evidence/lifecycle-reproduction.txt |

## 场景证据

- 未修改的目标命题：ChangeSet scope 仅 Procedure，目标仍合法、显示 2 条规则并可展开章节定义。
- 无效规范名称/别名引用：保留缺失提示且不显示虚假展开，不阻断主内容。
- 同字段混合合法与缺失引用：API 精确投影有效成员，UI 有效命题可展开，无效命题无 toggle。
- 同 ChangeSet 修改 Procedure 与 Statement：API 精确核对 baseline 的原 2 条规则和 candidate 的新 3 条规则，浏览器只展示 candidate 3 条、无 baseline 正文；点击仍读取同一 change 的 candidate 正文。重复三次 API 请求结果一致。
- 没有 checkpoint 的 View ChangeSet：复用完整 baseline candidate；稳定 canonical header 和目标规则正文确实加载成功。
- 正式/候选双向切换：同一应用实例先缓存正式内容、进入正文/标题不同的候选，再退出及往返；等待正确版本标题、正式目录响应和实际正文，确认正式目录无候选标题、正式详情无候选正文、候选详情无正式正文。
- 普通 Memory、现有 ChangeSet 差异和评论行为：完整受影响文件及全量回归均通过。规则投影继续被既有 diff 排除，原始声明/定位未修改。

## 失败、历史与环境

本 Run 初次 playwright-cli 发现无 checkpoint 的候选摘要 400，旧断言可能命中旧 DOM。这是本轮遗漏，不归为历史或环境错误；已修正接口并加强断言。首次全量执行因此主动停止（exit 130），保存为 evidence/full-tests-before-navigation-fix.txt，不计入最终通过结果。旧浏览器证据另保留为 evidence/browser-before-navigation-fix.txt。最终全量及稳定浏览器检查均在修正后重新执行。

前序会话的 146 文件结果未用来代替本 Run 验证。浏览器在宿主许可下运行，复用已安装本地依赖；最终没有未恢复的环境阻塞。

成果评审第一轮又发现候选详情污染正式缓存：已禁止候选写入正式缓存，在离开候选时重载正式目录/详情，并在 Project 切换时清空正式缓存。当前报告为第二轮修正后的最新 Workspace 报告；前序 Run 冻结的初始验证产物仍是第一轮 30 项版本。第一轮通过证据保留在 evidence/revision-1/，第二轮新增回归后重新执行 31 项受影响测试、全量回归、typecheck/build 和 playwright-cli，均通过。

## Memory 与未执行项

最终 `git diff --name-only -- .memsphere/memory reserved-memory src/skills` 无输出：无 Memory 交付差异，不创建空 ChangeSet；普通 validate 只作为当前 Store 健康证据。

未执行：生产 View 升级/发布、Human 验收、commit/PR/远端 CI（流程后续步骤）。尚未声称需求验收或最终交付完成。

## 可复核材料

evidence/source-digests.txt 记录本轮最终四个代码/测试文件 SHA256，验证结束时 `sha256sum -c` 全通过。evidence/changeset-reference-expanded.png 为隔离测试数据的真实 View 截图，展示有效引用与展开内容，不宣称是真实用户 ChangeSet 已发布后的页面。
