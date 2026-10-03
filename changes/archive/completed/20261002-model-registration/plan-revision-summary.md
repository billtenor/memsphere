# 实施方案第 3 轮修订

- 接纳研发阻塞意见：明确项目 DataStore models/json-schema/draft-07、导入 DataStore models/imported/json-schema/draft-07，均使用 memsphere/filesystem 和原始 bytes；登记 ValueStore 配置与模型 store_id 分离。登记根迁移同时复制导入定义原文字节，store_id 保持稳定，补齐身份/未知 Store/跨区域冲突测试。
- 接纳测试阻塞意见：本地包资产内联 TypeScript 源模块，由 tsc 生成 dist/project/model-market-assets.js，不依赖未复制 JSON 或 Workspace examples。明确 clean build、npm pack --ignore-scripts、解包内容断言及从 packed dist 启动真实市场预览/导入 API 的集成验证。
- 第二轮架构 Agent 已通过；保留搜索、采用 Statement、路径隔离、正式设置/迁移和交付测试范围，尚未开始开发。
