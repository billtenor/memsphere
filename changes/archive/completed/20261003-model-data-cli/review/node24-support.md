# Node 24 LTS 与 CI 调整

Human 在 PR 85 CI 跟进后要求统一 Node 24 LTS，并删除额外的 Node 20 专项 CI。此要求替代原实施方案中维护 Node 20 最低版本检查的决定；原批准材料与历史验证记录保留。

package.json 与 lockfile 的最低版本改为 >=24，@types/node 使用 24 系列，.nvmrc 选择 24。现有 Linux、macOS、Windows 全量测试及 Windows 四种 Shell 的安装包检查均使用 Node 24。删除 node20-model-data-smoke 三平台 job，不增加替代专项 job；文件锁与 CLI 测试继续由全量测试执行。保留已有手工冒烟脚本。

同步中英文 README、Skill、教程第一章与 Memsphere Concept 的版本要求。System Memory 源文件与当前开发 Project 副本一致，路径、规范名称及 manifest 清单不变。

验证使用临时安装的 Node 24.21.0，不使用宿主默认 Node 22 的结果冒充 Node 24 验证。typecheck、build，文件锁 / 跨进程数据 / Reserved Store 受影响测试 28/28，以及真实构建 CLI、真实安装包、Project 冒烟均通过。最新完整回归及新 head 的五项 CI 仍待完成，最终结果记录在 Run run-20261006-084310z-392905a8 的最终产物中。

普通 Memory validate 与最终变更级校验通过：ChangeSet change-20261006-084614240z-457c8bf3，checkpointDigest 5844dab6844f56ae95de7d838c060b226194843f9f474db615608b7551a553e8，View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261006-084614240z-457c8bf3 。原始结构化回执保存在本次执行环境的 /tmp/memsphere-node24-memory-change.json。
