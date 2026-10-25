# 自由探索体验优化：实现与验证验收第2轮

本轮修订依据Human明确要求：“只记录人工增删，outputs通过推导得到……每次上报artifact都去修改run，又变成有生命周期的并行冲突了。”第1轮Human及Agent通过票保留；Runner据此投修改，本轮重新审查。

## 修订结果

Run不保存完整outputs，只保存可选outputOverrides：

```json
{
  "outputOverrides": {
    "addedArtifactIds": ["artifact-comparison"],
    "removedArtifactIds": ["artifact-intermediate"]
  }
}
```

自动成果＝完整submitted产物中未被实际依赖且未被修订替换的产物；实际成果＝（自动成果∪人工添加）－人工移除。Snapshot.outputArtifactIds及View/API字段是计算结果，不是Run Store字段。人工添加明确保留直到移除；移除只隐藏具体ID，不删除记录或依赖。人工相反操作取消旧选择；相同调整幂等。finish显式选择最终根，在结束CAS中仅存差值，终态结果固定。

普通report、修订和redo均不写Run。真实技术共创Run上报最终方案时，Run revision前后均为4且envelope完全未变；推导根自动切到artifact-ddbb2db6-6e80-44db-9721-20e03b64494b。原历史保留，当前图5份Artifact、3份External。

两类旧模型转换保留已选根及空集合；旧版report中断时接续原提交，避免误记人工隐藏。第1轮研发／测试两条非阻断建议均采纳：升级互斥回归、pointercancel／lostpointercapture／blur停止回归。其余F1–F9和兼容边界保持原确认范围。

## 本轮验证

- 全量160文件、1337通过、2平台跳过、0失败；包含pretest完整build，单独typecheck通过。
- Project validate及Memory ChangeSet验证通过，checkpoint 80b41e820f7130bc993663284ef7ca05c88dd355cba9d2f7caa09b2cf79919c7。
- 真实3份Run模型转换、report不写Run、最新页面及浮窗核验通过，console无错误警告。

当前全部实现与测试仍在工作区，Reviewer必须检查未跟踪文件，不能只看git diff。主路径为src/context_control/outputs.ts、service.ts、src/project/context-control-upgrade.ts、两个领域测试及View浏览器测试。完整方案在changes/archive/completed/20261025-exploration-experience/implementation-plan.md，当前需求在requirements-revised.md。最终测试、模型字段与限制详见implementation-summary.md及initial-validation.md；不使用上一轮结果证明新候选。

证据：/tmp/memsphere-experience-tech/full-test-results-derived-final.json、full-tests-derived-final.log、real-report-no-run-write.json。Memory ChangeSet为change-20261025-083457940z-4ceb8c06，View：http://localhost:54270/projects/memsphere/changes/change-20261025-083457940z-4ceb8c06 。真实图：http://localhost:54270/projects/memsphere/tasks/run-67ed4607-6fc0-4310-ba4b-8a9e0b201de0 。尚未提交或创建PR；全局旧CLI／Skill未覆盖，使用本工作区node dist/cli.js及当前View。
