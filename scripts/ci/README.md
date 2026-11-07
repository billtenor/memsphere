# CI 基础设施脚本

- `ci-plan.mjs`：生成普通/完整 CI 矩阵。
- `test-plan.mjs`、`run-tests.mjs`、`test-durations.json`：递归发现、分组、执行测试与耗时数据。
- `full-health.mjs`：发布完整回归合并门禁。
- `ci-change-guard.mjs`：检查 CI 修改并发布授权门禁。
- `project-smoke.mjs`、`windows-package-smoke.mjs`：CI 的项目和 Windows 安装包冒烟验证。

`npm test`、`npm run test:ci`、`npm run smoke:project` 的入口保持不变。普通 CI 的 Linux、Windows 运行时组各分成两个独立任务，测试任务由 13 个增至 15 个；每个任务的并发数保持原值，普通任务仍为 5 分钟，完整 profile 仍为 20 分钟。完整 profile 的矩阵不变。

`test-durations.json` 记录实测耗时，只用于排序和均衡分片，不控制允许执行时间。`--shard=1/2`、`--shard=2/2` 按完整文件分配，同组分片的并集必须等于原测试集合且没有重复；分类、平台覆盖、排除表和成功条件不变。`--list` 可核对实际分配。只有包含浏览器用例的分片安装浏览器，结果文件和上传 artifact 使用独立分片标识。

整个目录受 CI change guard 保护。通用构建、迁移、开发安全检查和业务演示脚本保留在 scripts 根目录。

CI change guard 保护 `.github/workflows/`、`scripts/ci/` 和 `test/ci/`，另显式保护安全策略脚本 `scripts/security-check.sh`、`scripts/security-setup.sh` 及 `.gitleaks-privacy.toml`、`.gitleaksignore`。

产品构建脚本、模型校验、依赖清单/锁文件和编译配置不因被 CI 或 package scripts 调用而自动成为 CI 机制；其修改仍须通过正常评审、回归与安全检查。此门禁按文件路径判断，不检查 `package.json` 内个别 scripts 字段，因此不提供对这些字段的单独保护。
