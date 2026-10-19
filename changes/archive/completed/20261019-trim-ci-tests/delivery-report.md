# 测试删减与CI分层交付记录

实现按敏捷Run run-20261019-081003z-36eab35a组织。Human架构师与研发、测试、架构Agent通过成果验收，产品Agent通过交付评审。PR：https://github.com/billtenor/memsphere/pull/108 。最终head、default/full完整成功链接及残余问题由Run最终交付报告和PR持续维护；不将本文件所列较早SHA结果外推为后续提交成功。

## 改动与保护

四条重复/实现绑定用例合并，有效断言迁移；HTTP分类下沉；布局60→18点。教程、安全、权限、Git/路径/锁/修复等保护保留。默认149个文件在Linux全覆盖；macOS42文件；Windows34核心、6发布升级、2复用安装包job，合计233次，相对原444减少47.5%（当前同文件数全集447，减少47.9%）。完整构建18→8。daily/manual full保留原17矩阵行加安装包，三平台各全量一次。default/full取消组隔离，发布前目标SHA需full成功。

Windows测试和安装包job在runner.temp内复用Node原生编译缓存，不共享测试状态；每个测试文件继续独立MEMSPHERE_HOME。macOS平台4个文件进程，Windows两个平台行4个进程，安装包追加2文件并发2；不是新增job。默认285秒检查线和300秒job时限保持。

## 实际验证与成本

集成master d1cdc51后，npm test实跑149文件：1227通过、2平台跳过、0失败，381.97秒；pretest构建、typecheck、Store校验通过。CI修正后额外实跑42文件平台/升级保护及路由回归均通过；所有审查意见已处理，审计结果持久保存在test-audit.json（6个旧名称移除中包含4目标合并、1条CI替换为3条及1条样式改名，因此TAP净减2）。

历史同类PR工作流39218044291测试/打包18个job累计2849秒（47.48分钟）；f77d44d的PR工作流39247282874实测8个job累计1415秒（23.58分钟），减少50.3%。仅比较job completedAt-startedAt之和，包含安装/构建，不含作业排队，不等于CPU时间或账单。单次样本、不同SHA/runner及缓存情况，不能保证稳定同比降幅。该次预算计时276.5秒，workflow最终约282秒；full成本单列，不混作PR节省。历史full 39244967042为较早a5f1679成功证据，最终提交须独立再次完成full。

首轮Windows集中过载超时、第二轮总时长317.4秒、第三轮full争抢资源/平台超时等失败如实记录于change.md及Run。没有通过删保护、放宽预算或重复碰运气使其通过；采用既有job容量均衡，后续人工验证先default再full避免相互排队。

## 残余风险

未在platform清单内的OS特有故障可能延迟到每日full；发布前full仍是维护规则而非新增自动发布系统。GitHub master规则集19767795已核查，没有绑定被移除的矩阵检查名。本轮相对master无产品或Memory差异，不创建空ChangeSet。最终合入由Human执行。
