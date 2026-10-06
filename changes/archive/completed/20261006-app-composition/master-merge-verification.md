# 合并最新 master 后的验证

2026-10-06，应用户要求合并远端 master `a6520b1`（模型、Store 与数据 CLI，PR #85），保留双方能力。

## 冲突及接口适配

- 解决 data-layer-design、CLI 注册、Memory Catalog/Factory、Project Model Host、Skill 的六处冲突。模型快照一致性与 App 装配同时保留。
- App 模型与元模型使用 `.json` 后缀；安装读取时验证身份。费用示例与 CLI 同步调整。
- 适配 Memory 分页结果；App show/check 遍历所有页，新增重命名入口位于第 100 项之后的回归。
- 通用 model update/delete 拒绝 App 自有模型，避免写入与包内定义冲突的登记；专项测试覆盖两个操作。
- 费用 CLI 使用 Node 22，声明 fs-native-extensions 依赖。构建保留 native 包并在 CJS 中提供正确的模块定位。
- 真实安装发现 npm 本地目录默认软链接未安装 native 依赖，README 改为 `npm install --global --install-links --prefix "$HOME/.local" ./expense-app/cli`；清除隔离环境旧链接后按新命令安装成功。

## 实测结果

- npm ci --offline、npm run typecheck、npm run build：通过。
- App 专项：11/11 通过（/tmp/app-merge-app-tests.log）。
- npm test：1111 项，1110 通过、0 失败、1 Windows 专用测试跳过（/tmp/app-merge-full-tests.log）。
- 在 /tmp/memsphere-guide-e2e-hxdn3upp 安装实际 tarball、新建 Managed Project，按指南安装最小 App、费用 App 和独立 CLI，使用公开 view restart/status 启动正式 Shell。
- CLI 创建费用后页面刷新可见；页面创建并提交后 CLI list 读取到相同记录、submitted、revision 2；CLI 提交后页面刷新同样可见。窄屏 Tab 焦点检查通过，console 0 errors / 0 warnings。服务与浏览器已清理。
- 浏览器记录 ID：0225e887-db31-4a38-ab5f-cd7e177e5ce1；CLI 记录 ID：27dd68b1-44a5-4cea-ba28-5e344fa85b87。JSON 与截图保存于隔离验收目录。
- Project validate 与最终 ChangeSet validate 通过。旧 ChangeSet 因 Git 基线变化不能复用，已按 Embedded 标准路径重新校验。

## 最终 Memory 证据

- ChangeSet：change-20261006-131000236z-f1f1e871，valid。
- Base Revision：2eab7c28c100aebc8d160957edee32a55f4d1984。
- Content Digest：356dc60827e77cb1652ac50d32b4bc9280dfb6a8898ce2031e9316e462649808。
- View：http://0.0.0.0:30000/projects/memsphere/changes/change-20261006-131000236z-f1f1e871。
- 日志：/tmp/app-merge-changeset-validate.log。

Windows 原生 App 端到端未执行；其余已披露首版范围不变。此前验收报告保留原时点结果，合并后的最终证据以本文为准。
