# CLI text 输出修复

日期：2026-10-06（Asia/Shanghai）。Run：run-20261003-090655z-f1e492f6。
当前产品交付 Review：review-20261005-140919z-0e5efb80，Round：round-20261005-140919z-15827b8f。

Human 指出 --output json 和 --output text 都返回 JSON。原 emitCommandResult 始终 JSON.stringify，仅 text 使用两空格缩进，未兑现两种输出格式的区别。

修复新增 model、data、data store 的统一成功回执：json 仍输出单个完整 JSON 值；默认 text 与显式 text 用现有 YAML serializer 展示键值、缩进和列表。两者保留相同字段、嵌套值、数据类型和 nextCursor；不添加 YAML 锚点。错误仍按所选格式在 stderr 输出，失败 stdout 为空。原始 export --out - 正文不经过回执格式转换。

README 中英、发行 Skill、framework System Memory 源及开发副本同步说明该行为。未新增 Memory syntax 关键字。已批准需求/方案、第一轮实现验收与交付 Submission 保持原字节；旧验证证据作为历史保留。当前问题是需求范围内的实现修正，Human 的问题不是新的正式 Vote，不代其提交 request_changes 或 approve。

实际 source CLI 使用同一 Project/查询运行 model list --origin system --limit 1，text 返回 YAML 键值和列表，json 返回单个紧凑 JSON 对象，两者 nextCursor 相同。

新增 test/cli-output-format.test.ts 的四项真实 CLI 集成测试覆盖 model/data/data store 的 read、list、dry-run 和错误输出；显式 json、显式 text、默认 text 分别启动真实 CLI。校验特殊字符串、多行文本、嵌套对象/数组/空值的完整内容；分页游标跨格式继续使用；只读和预检保留文件内容、目录及 mtime。既有 list-pagination-cli 的默认 text 用例改用 YAML 解析，原 items 内容断言不变，JSON 用例保持原样。

最终定向命令 `node --import tsx --test test/cli-output-format.test.ts test/cli-errors.test.ts` 已真实通过，7/7、0 失败、退出 0，耗时 52.606 秒。日志 /tmp/memsphere-output-format-targeted-final.log，SHA-256 0b33cf8d63da42643f493a3dec3f9d773c96680cf9a1e0001ca65341225c015f。

新增 fixture 的一次括号语法错误，以及随后将三次独立 create dry-run 的随机登记 UUID 当作相同结果进行比较的测试失败均保留原日志。修正为先建立真实登记，再比较现有模型 update dry-run 的三种完整回执，保留整个 files 字段和无文件副作用断言，没有修改产品 UUID 规则或弱化路径检查。

最终完整 `npm test -- --test-concurrency=1` 已通过，1,072 项、1,071 通过、0 失败、1 Windows 专属跳过，退出 0；实际耗时 587.914 秒（含 pretest build），TAP 577.732 秒。日志 /tmp/memsphere-output-format-full-test.log，SHA-256 9ad854d2221d7ffe69632b3dc633b9583f34ff706fe96038b3b4bf8896d34e9e。

scripts/model-data-smoke.mjs 额外检查显式 model text 的游标延续、data store read 两种格式完整同值，以及 data read 默认 text 的完整同值。安装包冒烟打包安装后使用同一脚本运行已安装 CLI，因此也实际覆盖上述文本输出；JSON CRUD、原生锁和导出断言均保留。

独立 typecheck 退出 0（9.073 秒）、build 退出 0（10.548 秒）、Project smoke 退出 0（2.526 秒）、构建 CLI smoke 退出 0（16.285 秒）、实际安装包 smoke 退出 0（21.365 秒）。最终六项命令、退出码、日志哈希、测试文件及历史失败索引见 ../output-format-verification-results.json。修复和本轮验证已完成；本地实际平台为 Linux / Node 22.16.0，不以 CI 配置代替 Node20/macOS/Windows 验证。未 commit/PR，产品交付仍待正式 Human 票。

最终构建后已再次执行 node dist/cli.js --project memsphere validate 与 memory change validate，均退出 0。ChangeSet change-20261005-031024825z-a1b5f8c3，validation passed，base 2b7400b0d3bff6670982ebcd0a02f023a6859e34，当前 digest 076c3c71256feb93c6754b44fecaa97d0b461b2da54b15da7bc1321a10a1f04e。View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261005-031024825z-a1b5f8c3 。三份 System Memory 源与开发副本一致，最终校验后未再修改 Memory；前一交付报告所记 digest 作为历史保留，不当作本修复的当前证据。
