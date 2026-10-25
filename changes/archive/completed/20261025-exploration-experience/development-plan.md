# 自由探索体验优化：开发计划

基线：实施与验证方案第3轮round-20261025-080326z-04624591，Human、研发、架构及Runner通过；测试意见已逐项处置并纳入以下本轮强制任务。遵循该冻结方案及F1–F10／AC1–AC15，不扩大ACP或旧流程范围。

| 顺序 | 任务 | 完成标准 |
| --- | --- | --- |
| 1 | 整理Context Control短操作锁及受限模型升级 | Project→Run→ValueStore，无嵌套锁；initialize升级既有Run字段，旧值校验、目标校验、日志恢复、空集合幂等；旧流程及无关Store不变 |
| 2 | Run成果根及report／redo／查询 | outputs推导、Run只存人工增删、report／redo不写Run、finish保存差值；全部根读取先恢复；run list在Project锁内逐Run恢复并释放锁，任一持续失败则整次请求失败，不能输出部分成功列表 |
| 3 | Home CommandState及全局Continue | 唯一Home资源、Runtime与JSON Store；显式C与动态help；仅自由探索七项业务写，查询普通；启动回执与status找回，终态以Run为准 |
| 4 | 直接生产与辅助读取窗口 | 删除普通create／target／--for；真实读取尽力归属，辅助CAS不阻断；部分report披露身份与status恢复命令，原样重试不承诺请求去重 |
| 5 | 输出及文件导出 | external add只两个ID；200 chars预览、合法JSON、完整原字节独占导出、二进制不回显 |
| 6 | 现有Run图 | outputs默认闭包、空集合不回退、External节点／详情、版本及浮窗不回归、Pointer手抓和边端点高亮 |
| 7 | 文档／Skill／相关Memory | 帮助及示例与实际一致；仅修改实际涉及的Memory，Reserved及安装副本一致，最终ChangeSet验证 |
| 8 | 验证、实现摘要及初始验证报告 | 先定向后全量，真实浏览器桌面／窄屏，区分亲自执行与未验证，不把草案校验当作功能结果 |

## 强制定向验证

- Context Control服务／CLI／graph／View／browser：串行与并行根、修订、手动移出、空集合、所有读入口含run list的中断／故障解除、另一写操作与进程重启恢复；原样report重试实际身份数量。
- 新CommandState／升级套件使用临时Home及Store，覆盖跨进程、坏记录、CAS、旧Run running／done／abandoned、未完成Step、定义／记录写到一半后重试及外部冲突保留。
- test/reserved-models.test.ts：Home资源与Project系统／market隔离、重复ID／坏路径／坏源、打包路径。
- test/model-operation.test.ts：只为受限升级允许目标路径，其他业务Store仍拒绝；pending／recovering不读混合值；恢复只还原原before。
- test/model-upgrade.test.ts、test/project-model-registration-cli.test.ts：初始化幂等、旧格式升级、空成果保持人工隐藏、已有系统模型机制不回归。
- test/business-data-service.test.ts：五个受管Store通用数据访问与Context Control升级互斥、固定锁序、无嵌套锁；无关Store不变。
- 全量npm run typecheck、npm test、npm run build、memsphere validate；最终Memory差异存在时memsphere memory change validate。
- Playwright使用已有授权操作真实View，覆盖External、默认成果图、历史／浮窗、横纵拖动、移出取消、边悬停端点及console。

本计划的任务拆解不改变已确认的字段、恢复行为或范围；执行过程中如有实质方案变化，先按同等确认要求处理。
