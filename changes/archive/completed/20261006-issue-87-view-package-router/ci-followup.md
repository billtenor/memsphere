# PR CI 跟进

PR：https://github.com/billtenor/memsphere/pull/89。

第一轮 head fc58ccc，CI run 37487335553：新增 Router 浏览器用例在 Linux、macOS、Windows 均通过，Gitleaks 与其他跨平台分类及 Windows 打包通过。Windows Review & Shell UI 中既有 `Agent Activity expands in the participant row without disrupting Human review` 用例等待 `产物评审 1/2` 超时，导致汇总检查失败。整套 CI 耗时 216.5 秒，未超过 300 秒预算；汇总失败由测试失败引起。

该 UI fixture 启动模拟 ACP reviewer 后，仅检查 attempt 存在，未验证提交成功。其模拟 Agent 会调用多个 CLI 子进程，启动/空闲超时设为 10 秒、总运行 20 秒，在 Windows 负载下可能使前置评审未提交却继续到 UI 等待。

修正仅针对该测试 fixture：启动和空闲允许 30 秒、总运行 60 秒，增加 attempt 为 submitted 和 approve 已提交断言，使失败直接报告前置 attempt 状态。生产 ACP 超时与权限配置不改动。该测试目标是 Activity/UI 交互，不是超时契约。

本地该文件 19/19 通过（Linux/Node 22），git diff --check 通过。将在新 head 上重跑全部 CI，以 Windows 结果确认 fixture 修正；不通过放宽 CI 预算或跳过测试处理失败。
