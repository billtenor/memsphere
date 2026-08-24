# 提需方验收第一轮修改摘要

- 按需求负责人反馈移除 View 废弃流程中的原因输入框。
- 用户点击“废弃”后只展示一次风险提醒；确认后立即提交空请求并把 Run 转为 abandoned，取消则不操作。
- CLI/API 仍兼容可选原因，用于自动化或显式审计场景；View 不再要求普通用户填写。
- 更新 View 静态契约与 API 集成测试，验证无 prompt、仅 confirm、无原因也能成功废弃。
- Playwright CLI 真实浏览器验证通过：点击“废弃”后首个且唯一弹窗为确认框，确认后立即进入 abandoned，页面无原因字段且归档仍独立可用。
- 合并最新 master 后全量测试 412 total / 411 passed / 0 failed / 1 Windows-only skipped，typecheck 通过。
