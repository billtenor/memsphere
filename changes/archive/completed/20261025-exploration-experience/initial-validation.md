# 自由探索体验优化：修订版验证报告

本轮对象是包含outputs推导修订的最终工作区，正式Run为run-20261025-035719z-bcc49b1e。第1轮完整outputs存储实现的票及证据保留为历史，不作为本轮批准。

| 检查 | 本轮结果 |
| --- | --- |
| npm run typecheck | 通过；typecheck-derived-final.log |
| CI_TEST_RESULTS=…/full-test-results-derived-final.json npm test | 160个文件，1337通过、2平台跳过、0失败 |
| npm test的pretest：npm run build | 编译、5个项目模型、Home模型及全部View资源构建通过 |
| memsphere validate --format json | valid=true，issues=[] |
| memory change validate change-20261025-083457940z-4ceb8c06 --format json | valid=true；checkpoint 80b41e820f7130bc993663284ef7ca05c88dd355cba9d2f7caa09b2cf79919c7 |
| 真实项目显式模型升级 | 3份Run转换完成，原Artifact及Review保留；Store不含完整outputArtifactIds |
| 真实report | 最终方案上报前后Run revision均为4，envelope完全相同；根自动变为新Artifact |
| Playwright CLI真实页面 | 5份Artifact、3份External、14条边；最新方案浮窗可读新规则；console 0错误0警告 |

## 关键契约

- report、修订、两个并行生产者、提交中断后的读侧redo均不调用Run update，Run envelope及revision不变；submitted内容及旧依赖保留。
- 自动成果排除实际被依赖及被修订的产物；合并人工添加、减去人工移除。人工添加保留直到移除，隐藏只作用具体ID，新修订可自动出现。人工操作反向取消旧选择，相同操作幂等，finish精确冻结交付根且不存完整根列表。
- 两类旧Schema保留原根、人工旧版选择及空终态集合；旧report中断时先接续原提交的成果变换，再转换人工差值。受控发布中断可回滚／重试；升级与report及通用data访问共用门禁。
- Browser集成补充pointercancel、lostpointercapture、blur三条停止路径；历史切图、浮窗翻页、External内容、双轴拖拽及边端点高亮保留。
- 全量同时覆盖Continue动态帮助、辅助窗口CAS、200 chars及完整排他导出、原流程、正式Review、Memory、Archive与Store既有行为。

模块测试采用临时Store；真实CLI、HTTP和浏览器属于集成测试。两个平台跳过不计为通过。Linux／Node22／Chromium已验证，其他平台、浏览器和远端Store未亲测。全局旧CLI／Skill未覆盖，当前实现入口为本工作区node dist/cli.js及重启后的View。

## 证据

/tmp/memsphere-experience-tech/full-test-results-derived-final.json、full-tests-derived-final.log、typecheck-derived-final.log、project-validation-derived.json、memory-change-validation-derived.json、real-report-no-run-write.json、real-derived-store-evidence.json、derived-real-view-counts.json、derived-real-dialog.json、derived-browser-console.log。定向旧版中断升级回归为derived-upgrade-final.log。

首轮定向过程中修改了动态模型说明，导致两个夹具触发MODEL_INCOMPATIBLE保护；模型固定后以本轮完整构建及全量结果重新核验。此前未完成的全量已明确停止并替换，不混用旧验证结果。

Memory View：http://localhost:54270/projects/memsphere/changes/change-20261025-083457940z-4ceb8c06 。Store及Memory副本自最终校验后没有修改。适用规范为statements/memsphere-repository-testing-rules及开发、需求、交付规范。
