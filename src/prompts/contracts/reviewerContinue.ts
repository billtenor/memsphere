import { reviewerContracts } from "./reviewer.js";
import { inherit } from "./types.js";

export const reviewerContinueContracts = {
  "continue report": [
    inherit(reviewerContracts["run review report"], "reviewer-run-review-report-1", "reviewer-continue-continue-report-1",
      { rule: "操作标识仅限本人、该节点和本次保存。 绑定身份隐式确定目标；动作使用 Session launcher。", omit: ["tree", "nodes", "comments"] }),
  ],
  "continue update": [
    inherit(reviewerContracts["run review update"], "reviewer-run-review-update-1", "reviewer-continue-continue-update-1",
      { rule: "操作标识仅限本人、该节点和本次保存。 绑定身份隐式确定目标；动作使用 Session launcher。", omit: ["tree", "nodes", "comments"] }),
  ],
  "continue comment add": [
    inherit(reviewerContracts["run review comment add"], "reviewer-run-review-comment-add-1", "reviewer-continue-continue-comment-add-1",
      { rule: "操作标识仅限本人、该节点和本次保存。 绑定身份隐式确定目标；动作使用 Session launcher。", omit: ["tree", "nodes", "comments"] }),
  ],
  "continue comment update": [
    inherit(reviewerContracts["run review comment update"], "reviewer-run-review-comment-update-1", "reviewer-continue-continue-comment-update-1",
      { rule: "操作标识仅限本人、该节点和本次保存。 绑定身份隐式确定目标；动作使用 Session launcher。", omit: ["tree", "nodes", "comments"] }),
  ],
  "continue comment delete": [
    inherit(reviewerContracts["run review comment delete"], "reviewer-run-review-comment-delete-1", "reviewer-continue-continue-comment-delete-1",
      { rule: "操作标识仅限本人、该节点和本次保存。 绑定身份隐式确定目标；动作使用 Session launcher。", omit: ["tree", "nodes", "comments"] }),
  ],
  "continue list": [
    inherit(reviewerContracts["run review list"], "reviewer-run-review-list-2", "reviewer-continue-continue-list-1",
      { rule: "tree 递归只给节点摘要、计数和 children；禁止 node.comments、ruleResults 或草稿正文。" }),
  ],
  "continue show": [
    inherit(reviewerContracts["run review show"], "reviewer-run-review-show-2", "reviewer-continue-continue-show-1",
      { rule: "显式 --node 只给指定节点，无选项时给当前节点。已提交后禁止写动作。 绑定身份隐式确定目标；动作使用 Session launcher。", omit: ["tree"] }),
    inherit(reviewerContracts["run review show"], "reviewer-run-review-show-3", "reviewer-continue-continue-show-2",
      { rule: "显式 --all 可看本人各节点已存判断及该节点意见。 绑定身份隐式确定目标；动作使用 Session launcher。" }),
    inherit(reviewerContracts["run review show"], "reviewer-run-review-show-4", "reviewer-continue-continue-show-3",
      { rule: "只给可见节点结果和获准的已存意见。 绑定身份隐式确定目标；动作使用 Session launcher。" }),
  ],
  "continue submit": [
    inherit(reviewerContracts["run review submit"], "reviewer-run-review-submit-2", "reviewer-continue-continue-submit-1",
      { rule: "只回本人提交状态；不再给写动作。 绑定身份隐式确定目标；动作使用 Session launcher。", omit: ["nextAction", "tree", "nodes", "comments"] }),
  ],
};
