# CI 基础设施脚本

- `ci-plan.mjs`：生成普通/完整 CI 矩阵。
- `test-plan.mjs`、`run-tests.mjs`、`test-durations.json`：递归发现、分组、执行测试与耗时数据。
- `full-health.mjs`：发布完整回归合并门禁。
- `ci-change-guard.mjs`：检查 CI 修改并发布授权门禁。
- `project-smoke.mjs`、`windows-package-smoke.mjs`：CI 的项目和 Windows 安装包冒烟验证。

`npm test`、`npm run test:ci`、`npm run smoke:project` 的入口保持不变。工作流和测试中的路径已同步；测试矩阵、并发和超时标准不变。

整个目录受 CI change guard 保护。通用构建、迁移、开发安全检查和业务演示脚本保留在 scripts 根目录。

CI change guard 保护 `.github/workflows/`、`scripts/ci/` 和 `test/ci/`，另显式保护安全策略脚本 `scripts/security-check.sh`、`scripts/security-setup.sh` 及 `.gitleaks-privacy.toml`、`.gitleaksignore`。

产品构建脚本、模型校验、依赖清单/锁文件和编译配置不因被 CI 或 package scripts 调用而自动成为 CI 机制；其修改仍须通过正常评审、回归与安全检查。此门禁按文件路径判断，不检查 `package.json` 内个别 scripts 字段，因此不提供对这些字段的单独保护。
