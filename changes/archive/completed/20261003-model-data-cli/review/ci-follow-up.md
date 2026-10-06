# PR #85 CI 修复跟进

2026-10-06，Human 要求持续跟进至所有 CI 成功。沿用 PR #85、分支 codex/model-data-cli；后续 CI 任务记录于 Run run-20261006-065351z-1d8ac4fa，原敏捷 Run 已完成，不改历史冻结评审产物。

## 初次失败及修复

原 head 85aed8668eea5514e3d1acaf0a44a19391a1d892，CI Run 37424003929、Security Run 37424003951。

- macOS 系统临时目录的 /var 前缀实际指向 /private/var；模型修改把可信 Project 根路径中的别名误报为模型目录内路径转向。模型写入现在只规范化可信 Project 根前缀，日志以真实根与目标路径保存；模型存储内部符号链接及越界目标仍拒绝。添加真实目录别名下成功写入及失败回滚两个回归契约。
- 跨进程测试、故障注入和路径断言使用 mkdtemp 原始路径，实际 Store 使用 fs.realpath 后的路径。macOS 前缀和 Windows 临时目录别名使 IPC 等待或故障注入没有命中真实调用。统一测试 fixture 与 Worker 的实际路径，保持原成功、冲突、故障和进程中断断言，不跳过测试。
- Security 的三个 generic-api-key 命中是不可变人工 CLI 验收记录中的文件 SHA-256。逐项与原 commit 的实际 blob 字节计算结果一致，确认不是凭据。只加入原 commit、原文件、原规则、原行号三个精确历史 fingerprint；不扩展文件或规则级 allowlist，原验收证据保持不变。

## 本地验证与继续条件

- 受影响五个文件：73 项测试全部通过，0 失败，含新增两项 Project 别名回归。
- typecheck、build、构建 CLI 和真实安装包冒烟通过。普通 Memory validate 通过。
- Project 冒烟初次和完整回归的前置构建重叠，dist 暂时移除导致 ENOENT；构建完成后复验通过。属于本地验证调度错误，保留原失败日志，没有据此改产品实现或降低断言。
- Gitleaks 本地按原 PR commit 范围与相同配置重新扫描通过（本地版本 8.30.1，GitHub Action 为 8.24.3）；仍需由 GitHub Security 确认。
- 完整 npm test 串行回归正在执行；新 head 的三平台主套件、Node 20 锁/CLI、Windows 安装包与 Security 结果以 GitHub 为准，尚未宣布全部 CI 成功。

本次未修改 Memory、命令契约或已批准范围。现有最终 Memory Checkpoint change-20261005-031024825z-a1b5f8c3 的内容仍匹配，passed，digest 076c3c71256feb93c6754b44fecaa97d0b461b2da54b15da7bc1321a10a1f04e，View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261005-031024825z-a1b5f8c3 。不创建空 ChangeSet。

修复 commit 推送后继续观察最新 head，发现新问题则修复并复验；只有最新 head 的全部检查成功才上报 CI 跟进 Run 完成。不合并 PR、不发布 GitHub review/comment。

## 第二次修正：Windows CLI 并发测试

head bb4456d5c535e221fedba8f80fadb3e0a5b8f662 的 Security、三平台 Node 20、Windows 安装包，以及 Ubuntu / macOS 完整套件全部通过。Windows 完整套件 job 112148552677（CI Run 37426859157）在 30 分钟限额处取消。

实际日志只有一条失败：two CLI edits that capture the same revision commit exactly one complete patch。第一个 CLI 的 rename 返回 EPERM；测试暂停第二个 CLI 的位置尚未关闭数据文件句柄，人为阻止了 Windows 对同一文件的替换。之后日志完成至第 190 项，进程没有正常退出，最终由 job 时限取消。

修正只涉及测试：CLI Worker 读取完整快照并关闭句柄后，再发出 captured 并暂停；两个 CLI 仍捕获同一 revision，原“仅一个修改成功、另一个报冲突、最终值和 revision 正确”全部断言保留。失败清理等待 Worker 的 exit 并销毁管道，不等待可能由其子进程保留的 stdio close。未增加 job 时限，也未修改产品的锁、替换或 revision 实现。

本地受影响文件 12/12 通过，0 失败；当前普通 Memory validate 通过。第二次完整 npm test 正在执行，后续还须持续跟进新 head 的全部八项 CI。原日志及上一次成功的完整本地回归 1,074 项（1,073 通过、1 跳过）作为历史证据保留，不代替第二次验证。

## 第三次修正：模型信息浏览器测试

第二次本地完整回归最终通过：1,074 项，1,073 通过、0 失败、1 个平台条件跳过。head caf97b2598a1b05d247555dc634e606bf303e55a 的 Security、三平台 Node 20、Windows 安装包和 macOS 完整套件通过；Ubuntu job 112159548116（CI Run 37430361635）完整回归只有一条失败，model information is the default tab and orders identity, standard, tags and storage fields。

测试先等待表格出现，再分别读取表格；路由规范化触发详情重绘时，这两次读取之间表格被移除，表头得到空数组。修正为在有时限的 DOM 轮询中等待指定模型的完整八行表格，并一次捕获表头、值和选中状态。原字段顺序、字段值、默认选项和结构表不存在的校验均保留；没有固定等待、跳过测试或修改产品 UI。

本地受影响浏览器文件 31/31 通过，类型检查通过。第三次完整回归与最新 head 的全部八项 CI 仍须完成；最终结果记录在 CI 跟进 Run run-20261006-065351z-1d8ac4fa 的最终产物中。

第三次完整本地回归最终为 1,074 项，1,073 通过、0 失败、1 跳过，576,963.747577 毫秒。随后 head caf97b 的 Windows 完整套件正常结束（1,074 项，1,070 通过、1 失败、3 平台条件跳过）；并发编辑测试通过，不再因文件句柄阻止替换，也没有失败清理挂住。剩余失败为模型结构展示测试首次进入页面时未出现目标标题。

结构展示测试改为直接访问带 scope=custom 的规范化地址，避免在前置访问中额外验证路由改写；已有模型深链接测试保留。浏览器 helper 在失败时输出当前 URL、模型 API 响应状态、页面正文与 pageerror，保留诊断。没有提高等待时限，Windows 原因及修复效果仍须由新一轮 CI 验证。

Human 进一步要求核查测试规范与耗时。读取完整 testing rules 后，检查了串行 CI 配置与测试启动方式。将新增的普通模型、数据和输出测试从 tsx 启动源码改为直接运行 pretest 已构建的 dist/cli.js；跨进程 IPC 注入 Worker 保持原方式。22 项受影响测试全部通过，全部原调用、断言、真实子进程边界和退出码校验保留。耗时对比与规范审查见同目录 testing-audit.md；最新完整回归和八项 CI 尚待验证。
