# Node 22 与 CI 调整

Human 明确确认：保留 Node 22，删除 Node 20 专项 CI，最低版本声明改为 22。此要求替代原实施方案中维护 Node 20 最低版本检查的决定；原批准材料与历史验证记录保留。此前提交的 Node 24 升级扩大了授权范围，本次撤回。

package.json 与 lockfile 的最低版本改为 >=22，@types/node 恢复原有 22 系列，.nvmrc 选择 22。现有 Linux、macOS、Windows 全量测试及 Windows 四种 Shell 的安装包检查继续使用 Node 22。删除 node20-model-data-smoke 三平台 job，不增加替代专项 job；文件锁与 CLI 测试继续由全量测试执行。保留已有手工冒烟脚本。

同步中英文 README、Skill、教程第一章与 Memsphere Concept 的版本要求。System Memory 源文件与当前开发 Project 副本一致，路径、规范名称及 manifest 清单不变。

本次验证使用 Node 22。最终本地测试、最新提交五项 CI 和 Memory 变更级校验的结果记录在 Run run-20261006-084310z-392905a8 的最终产物中。

普通 Memory validate 与最终变更级校验通过：ChangeSet change-20261006-085308326z-02b4b3d9，checkpointDigest 6df123974d0dc85b32a41e3a736244316d44b726a5f30758f202b5c64fb87db4，View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261006-085308326z-02b4b3d9 。原始结构化回执保存在本次执行环境的 /tmp/memsphere-node22-memory-change.json。
