# 补充测试 case

## 自动化产物

新增 test/view-package-router-browser.test.ts，共五个测试组，均走真实 Package Manifest、resolver、HTTP View Server 和 Chromium：

1. 正式设置 validate/PUT 安装、启用、保存，重启前 404，重启后实例 active；Header/list/main.view、菜单、source 对象选择、关联跳转、直达、刷新、back/forward，以及相似前缀/未知实例/未知 Project 路径隔离。
2. 未声明 router.register 与禁用实例不获页面入口；前者 apply 前明确授权失败，后者不产生业务实例。
3. 路由冲突及路径拒绝矩阵：/./outside、/%2e/outside、/../outside、/%2e%2e/outside、字面反斜杠、编码斜杠、编码反斜杠、NUL、非法百分号编码。断言实例 failed、无自身路由残留、Shell 显示错误且 builtin 页面仍可访问。
4. 缺失 entry：resolver diagnostics invalid、不产生实例、实例页面 404。entry 为存在的 index.txt：启动资源注册拒绝，boot 实例含 loadError、不含 allowedServices，Runtime failed，无路由残留且页面 404。两者与浏览器失败不同。
5. entry.js 服务端成功提供，但浏览器 ESM 语法错误：页面 200、Shell ready、诊断 bundle could not be imported、实例 failed、无路由残留和局部无匹配错误。

更新 test/view-package-registry.test.ts：启用实例保留 router.register，仅供主题的派生实例去除该能力，同时保留 theme.register。

更新 test/view-package-config.test.ts：instance_id 为 . 或 .. 不能通过全局组合配置解析。

## 评审意见落实

研发第一轮提出的服务端资源失败覆盖已由第 4 组验证。测试第一轮提出的单点段覆盖已由第 3 组验证；源码本已同时拒绝解码后的 . 与 ..，用例明确证实该行为。

针对新增浏览器文件的开发阶段运行五组断言均成功；最终构建、类型检查和相关回归将在下一正式验证步骤执行并记录，不以此代替最终验收。

本次接入边界可以自动化，无需仅靠手工 case；私有 CRAA 集成及 Windows/macOS 未实测会在最终验证摘要披露。
