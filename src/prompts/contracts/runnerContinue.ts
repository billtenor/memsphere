import { runWorkContracts } from "./run-work.js";
import { runStateContracts } from "./run-state.js";
import { runReviewContracts } from "./run-review.js";
import { inherit } from "./types.js";

export const runnerContinueContracts = {
  "continue enter-schema": [
    inherit(runWorkContracts["run enter-schema"], "cli-run-enter-schema-1", "runner-continue-enter-schema-1",
      { rule: "有效步骤给 enter-schema。", omit: ["current", "position"] }),
    inherit(runWorkContracts["run enter-schema"], "cli-run-enter-schema-2", "runner-continue-enter-schema-2",
      { rule: "位置及字段用于本次写入；已失效草稿由历史分支处理。" }),
    inherit(runWorkContracts["run enter-schema"], "cli-run-enter-schema-3", "runner-continue-enter-schema-3",
      { rule: "只给导出与提交所需的信息。", omit: ["position", "current"] }),
    inherit(runWorkContracts["run enter-schema"], "cli-run-enter-schema-4", "runner-continue-enter-schema-4",
      { rule: "已完成可回读；失效草稿无写动作。", omit: ["position", "current"] }),
  ],
  "continue step show": [
    inherit(runStateContracts["run step show"], "cli-run-step-show-1", "runner-continue-step-show-1",
      { rule: "依次适用 graph、旧 flow、探索、受限 Reviewer；输入/规则只在当前授权范围。" }),
    inherit(runStateContracts["run step show"], "cli-run-step-show-3", "runner-continue-step-show-2",
      { rule: "依次适用 graph、旧 flow、探索、受限 Reviewer；输入/规则只在当前授权范围。" }),
  ],
  "continue step configure": [
    inherit(runStateContracts["run step configure"], "cli-run-step-configure-1", "runner-continue-step-configure-1",
      { rule: "给实际生效的步骤配置、缺项与合法 Reviewer 选项。" }),
  ],
  "continue schema show": [
    inherit(runWorkContracts["run schema show"], "cli-run-schema-show-1", "runner-continue-schema-show-1",
      { rule: "有效步骤给 enter-schema。", omit: ["current", "position"] }),
    inherit(runWorkContracts["run schema show"], "cli-run-schema-show-2", "runner-continue-schema-show-2",
      { rule: "位置及字段用于本次写入；已失效草稿由历史分支处理。" }),
    inherit(runWorkContracts["run schema show"], "cli-run-schema-show-3", "runner-continue-schema-show-3",
      { rule: "只给导出与提交所需的信息。", omit: ["position", "current"] }),
    inherit(runWorkContracts["run schema show"], "cli-run-schema-show-4", "runner-continue-schema-show-4",
      { rule: "已完成可回读；失效草稿无写动作。", omit: ["position", "current"] }),
  ],
  "continue schema report": [
    inherit(runWorkContracts["run schema report"], "cli-run-schema-report-1", "runner-continue-schema-report-1",
      { rule: "有效步骤给 enter-schema。", omit: ["current", "position"] }),
    inherit(runWorkContracts["run schema report"], "cli-run-schema-report-2", "runner-continue-schema-report-2",
      { rule: "位置及字段用于本次写入；已失效草稿由历史分支处理。" }),
    inherit(runWorkContracts["run schema report"], "cli-run-schema-report-3", "runner-continue-schema-report-3",
      { rule: "只给导出与提交所需的信息。", omit: ["position", "current"] }),
    inherit(runWorkContracts["run schema report"], "cli-run-schema-report-4", "runner-continue-schema-report-4",
      { rule: "已完成可回读；失效草稿无写动作。", omit: ["position", "current"] }),
  ],
  "continue skip": [
    inherit(runWorkContracts["run skip"], "cli-run-skip-1", "runner-continue-skip-1",
      { rule: "有效步骤给 enter-schema。", omit: ["current", "position"] }),
    inherit(runWorkContracts["run skip"], "cli-run-skip-2", "runner-continue-skip-2",
      { rule: "位置及字段用于本次写入；已失效草稿由历史分支处理。" }),
    inherit(runWorkContracts["run skip"], "cli-run-skip-3", "runner-continue-skip-3",
      { rule: "只给导出与提交所需的信息。", omit: ["position", "current"] }),
    inherit(runWorkContracts["run skip"], "cli-run-skip-4", "runner-continue-skip-4",
      { rule: "已完成可回读；失效草稿无写动作。", omit: ["position", "current"] }),
  ],
  "continue repeat": [
    inherit(runWorkContracts["run repeat"], "cli-run-repeat-1", "runner-continue-repeat-1",
      { rule: "有效步骤给 enter-schema。", omit: ["current", "position"] }),
    inherit(runWorkContracts["run repeat"], "cli-run-repeat-2", "runner-continue-repeat-2",
      { rule: "位置及字段用于本次写入；已失效草稿由历史分支处理。" }),
    inherit(runWorkContracts["run repeat"], "cli-run-repeat-3", "runner-continue-repeat-3",
      { rule: "只给导出与提交所需的信息。", omit: ["position", "current"] }),
    inherit(runWorkContracts["run repeat"], "cli-run-repeat-4", "runner-continue-repeat-4",
      { rule: "已完成可回读；失效草稿无写动作。", omit: ["position", "current"] }),
  ],
  "continue artifact export": [
    inherit(runWorkContracts["run artifact export"], "cli-run-artifact-export-1", "runner-continue-artifact-export-1",
      { rule: "graph/探索给导出位置及适用提交动作；旧 flow 给 stepRef 和文件。" }),
  ],
  "continue artifact tag": [
    inherit(runWorkContracts["run artifact tag"], "cli-run-artifact-tag-1", "runner-continue-artifact-tag-1",
      { rule: "只给 runId、artifactId、tags。" }),
  ],
  "continue review wait": [
    inherit(runReviewContracts["run review wait"], "cli-run-review-wait-1", "runner-continue-review-wait-1",
      { rule: "nextAction 为 wait；无完整分派表及意见正文。", omit: ["assignments", "comments", "vote"] }),
    inherit(runReviewContracts["run review wait"], "cli-run-review-wait-2", "runner-continue-review-wait-2",
      { rule: "正式轮次形成结论才给 outcome；需要决策时给本身份可执行的下一步。", omit: ["assignments", "comments", "vote", "taskId"] }),
    inherit(runReviewContracts["run review wait"], "cli-run-review-wait-3", "runner-continue-review-wait-3",
      { rule: "仅指向原轮次或只读入口，禁止再给投票和重报动作。", omit: ["assignments", "comments", "vote", "taskId"] }),
  ],
  "continue review vote": [
    inherit(runReviewContracts["run review vote"], "cli-run-review-vote-1", "runner-continue-review-vote-1",
      { rule: "仅给实际结果、计数与合法后继。", omit: ["assignments", "comments", "taskId"] }),
  ],
  "continue review resolve": [
    inherit(runReviewContracts["run review resolve"], "cli-run-review-resolve-1", "runner-continue-review-resolve-1",
      { rule: "给 reviewId/roundId/commentId/disposition 及后续动作，禁止授权原文。" }),
  ],
  "continue review submit-for-human": [
    inherit(runReviewContracts["run review submit-for-human"], "cli-run-review-submit-for-human-1", "runner-continue-review-submit-for-human-1",
      { rule: "仅给实际结果、计数与合法后继。", omit: ["assignments", "comments", "taskId"] }),
  ],
  "continue review retry": [
    inherit(runReviewContracts["run review retry"], "cli-run-review-retry-1", "runner-continue-review-retry-1",
      { rule: "仅给实际结果、计数与合法后继。", omit: ["assignments", "comments", "taskId"] }),
  ],
  "continue review start": [
    inherit(runReviewContracts["run review start"], "cli-run-review-start-1", "runner-continue-review-start-1",
      { rule: "派发后给等待或本人当前动作。", omit: ["tree", "nodes", "comments"] }),
  ],
  "continue review list": [
    inherit(runReviewContracts["run review list"], "cli-run-review-list-1", "runner-continue-review-list-1",
      { rule: "light 和 progressive 分别分页；轻量列表只给意见数与详情入口，正文移到 show。Reviewer 只列当前材料的固定确认。" }),
    inherit(runReviewContracts["run review list"], "cli-run-review-list-2", "runner-continue-review-list-2",
      { rule: "light 和 progressive 分别分页；轻量列表只给意见数与详情入口，正文移到 show。Reviewer 只列当前材料的固定确认。" }),
  ],
  "continue review show": [
    inherit(runReviewContracts["run review show"], "cli-run-review-show-1", "runner-continue-review-show-1",
      { rule: "按轻量、节点、轮次、固定确认选择形态。--all 才展开授权全文；节点只读本人允许的范围。" }),
    inherit(runReviewContracts["run review show"], "cli-run-review-show-2", "runner-continue-review-show-2",
      { rule: "显式 --node 只给指定节点，无选项时给当前节点。已提交后禁止写动作。", omit: ["tree"] }),
    inherit(runReviewContracts["run review show"], "cli-run-review-show-3", "runner-continue-review-show-3",
      { rule: "显式 --all 可看本人各节点已存判断及该节点意见。" }),
    inherit(runReviewContracts["run review show"], "cli-run-review-show-5", "runner-continue-review-show-4",
      { rule: "只给可见节点结果和获准的已存意见。" }),
  ],
  "continue review report": [
    inherit(runReviewContracts["run review report"], "cli-run-review-report-1", "runner-continue-review-report-1",
      { rule: "操作标识仅限本人、该节点和本次保存。", omit: ["tree", "nodes", "comments"] }),
  ],
  "continue review update": [
    inherit(runReviewContracts["run review update"], "cli-run-review-update-1", "runner-continue-review-update-1",
      { rule: "操作标识仅限本人、该节点和本次保存。", omit: ["tree", "nodes", "comments"] }),
  ],
  "continue review comment add": [
    inherit(runReviewContracts["run review comment add"], "cli-run-review-comment-add-1", "runner-continue-review-comment-add-1",
      { rule: "操作标识仅限本人、该节点和本次保存。", omit: ["tree", "nodes", "comments"] }),
  ],
  "continue review comment update": [
    inherit(runReviewContracts["run review comment update"], "cli-run-review-comment-update-1", "runner-continue-review-comment-update-1",
      { rule: "操作标识仅限本人、该节点和本次保存。", omit: ["tree", "nodes", "comments"] }),
  ],
  "continue review comment delete": [
    inherit(runReviewContracts["run review comment delete"], "cli-run-review-comment-delete-1", "runner-continue-review-comment-delete-1",
      { rule: "操作标识仅限本人、该节点和本次保存。", omit: ["tree", "nodes", "comments"] }),
  ],
  "continue review submit": [
    inherit(runReviewContracts["run review submit"], "cli-run-review-submit-1", "runner-continue-review-submit-1",
      { rule: "只回本人提交状态；不再给写动作。", omit: ["nextAction", "tree", "nodes", "comments"] }),
  ],
  "continue review create": [
    inherit(runReviewContracts["run review create"], "cli-run-review-create-1", "runner-continue-review-create-1",
      { rule: "只给本次反馈及其来源。轻量反馈没有正式投票或分派。" }),
  ],
  "continue report": [
    inherit(runStateContracts["run report"], "cli-run-report-1", "runner-continue-report-1",
      { rule: "已发起评审才给轮次；业务写入才给目的地；只有实际后继才给 next*。" }),
    inherit(runStateContracts["run report"], "cli-run-report-2", "runner-continue-report-2",
      { rule: "只给已存对象与候选引用，禁止回显报告正文。" }),
  ],
  "continue external add": [
    inherit(runWorkContracts["run external add"], "cli-run-external-add-1", "runner-continue-external-add-1",
      { rule: "只给 runId、externalId、公开 source；固定 ChangeSet 分支增加 checkpointDigest。禁止回显所加正文。", omit: ["content"] }),
    inherit(runWorkContracts["run external add"], "cli-run-external-add-2", "runner-continue-external-add-2",
      { rule: "只给 runId、externalId、公开 source；固定 ChangeSet 分支增加 checkpointDigest。禁止回显所加正文。", omit: ["content"] }),
  ],
  "continue outputs update": [
    inherit(runStateContracts["run outputs update"], "cli-run-outputs-update-1", "runner-continue-outputs-update-1",
      { rule: "当前输出集合；每项只给 id/name/status。" }),
  ],
  "continue finish": [
    inherit(runStateContracts["run finish"], "cli-run-finish-1", "runner-continue-finish-1",
      { rule: "结束原因可公开才给，详情只能读取。", omit: ["nextAction"] }),
  ],
  "continue abandon": [
    inherit(runStateContracts["run abandon"], "cli-run-abandon-1", "runner-continue-abandon-1",
      { rule: "结束原因可公开才给，详情只能读取。", omit: ["nextAction"] }),
  ],
};
