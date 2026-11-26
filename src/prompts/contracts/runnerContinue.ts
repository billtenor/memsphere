import { runWorkContracts } from "./run-work.js";
import { runStateContracts } from "./run-state.js";
import { runReviewContracts } from "./run-review.js";
import { inherit } from "./types.js";

export const runnerContinueContracts = {
  "continue enter-schema": [
    inherit(runWorkContracts["run enter-schema"], "cli-run-enter-schema-1", "runner-continue-enter-schema-1"),
    inherit(runWorkContracts["run enter-schema"], "cli-run-enter-schema-2", "runner-continue-enter-schema-2"),
    inherit(runWorkContracts["run enter-schema"], "cli-run-enter-schema-3", "runner-continue-enter-schema-3"),
    inherit(runWorkContracts["run enter-schema"], "cli-run-enter-schema-4", "runner-continue-enter-schema-4"),
  ],
  "continue step show": [
    inherit(runStateContracts["run step show"], "cli-run-step-show-1", "runner-continue-step-show-1"),
    inherit(runStateContracts["run step show"], "cli-run-step-show-3", "runner-continue-step-show-2"),
  ],
  "continue step configure": [
    inherit(runStateContracts["run step configure"], "cli-run-step-configure-1", "runner-continue-step-configure-1"),
  ],
  "continue schema show": [
    inherit(runWorkContracts["run schema show"], "cli-run-schema-show-1", "runner-continue-schema-show-1"),
    inherit(runWorkContracts["run schema show"], "cli-run-schema-show-2", "runner-continue-schema-show-2"),
    inherit(runWorkContracts["run schema show"], "cli-run-schema-show-3", "runner-continue-schema-show-3"),
    inherit(runWorkContracts["run schema show"], "cli-run-schema-show-4", "runner-continue-schema-show-4"),
  ],
  "continue schema report": [
    inherit(runWorkContracts["run schema report"], "cli-run-schema-report-1", "runner-continue-schema-report-1"),
    inherit(runWorkContracts["run schema report"], "cli-run-schema-report-2", "runner-continue-schema-report-2"),
    inherit(runWorkContracts["run schema report"], "cli-run-schema-report-3", "runner-continue-schema-report-3"),
    inherit(runWorkContracts["run schema report"], "cli-run-schema-report-4", "runner-continue-schema-report-4"),
  ],
  "continue skip": [
    inherit(runWorkContracts["run skip"], "cli-run-skip-1", "runner-continue-skip-1"),
    inherit(runWorkContracts["run skip"], "cli-run-skip-2", "runner-continue-skip-2"),
    inherit(runWorkContracts["run skip"], "cli-run-skip-3", "runner-continue-skip-3"),
    inherit(runWorkContracts["run skip"], "cli-run-skip-4", "runner-continue-skip-4"),
  ],
  "continue repeat": [
    inherit(runWorkContracts["run repeat"], "cli-run-repeat-1", "runner-continue-repeat-1"),
    inherit(runWorkContracts["run repeat"], "cli-run-repeat-2", "runner-continue-repeat-2"),
    inherit(runWorkContracts["run repeat"], "cli-run-repeat-3", "runner-continue-repeat-3"),
    inherit(runWorkContracts["run repeat"], "cli-run-repeat-4", "runner-continue-repeat-4"),
  ],
  "continue artifact export": [
    inherit(runWorkContracts["run artifact export"], "cli-run-artifact-export-1", "runner-continue-artifact-export-1"),
  ],
  "continue artifact tag": [
    inherit(runWorkContracts["run artifact tag"], "cli-run-artifact-tag-1", "runner-continue-artifact-tag-1"),
  ],
  "continue review wait": [
    inherit(runReviewContracts["run review wait"], "cli-run-review-wait-1", "runner-continue-review-wait-1"),
    inherit(runReviewContracts["run review wait"], "cli-run-review-wait-2", "runner-continue-review-wait-2"),
    inherit(runReviewContracts["run review wait"], "cli-run-review-wait-3", "runner-continue-review-wait-3"),
  ],
  "continue review vote": [
    inherit(runReviewContracts["run review vote"], "cli-run-review-vote-1", "runner-continue-review-vote-1"),
  ],
  "continue review resolve": [
    inherit(runReviewContracts["run review resolve"], "cli-run-review-resolve-1", "runner-continue-review-resolve-1"),
  ],
  "continue review submit-for-human": [
    inherit(runReviewContracts["run review submit-for-human"], "cli-run-review-submit-for-human-1", "runner-continue-review-submit-for-human-1"),
  ],
  "continue review retry": [
    inherit(runReviewContracts["run review retry"], "cli-run-review-retry-1", "runner-continue-review-retry-1"),
  ],
  "continue review start": [
    inherit(runReviewContracts["run review start"], "cli-run-review-start-1", "runner-continue-review-start-1"),
  ],
  "continue review list": [
    inherit(runReviewContracts["run review list"], "cli-run-review-list-1", "runner-continue-review-list-1"),
    inherit(runReviewContracts["run review list"], "cli-run-review-list-2", "runner-continue-review-list-2"),
  ],
  "continue review show": [
    inherit(runReviewContracts["run review show"], "cli-run-review-show-1", "runner-continue-review-show-1"),
    inherit(runReviewContracts["run review show"], "cli-run-review-show-2", "runner-continue-review-show-2"),
    inherit(runReviewContracts["run review show"], "cli-run-review-show-3", "runner-continue-review-show-3"),
    inherit(runReviewContracts["run review show"], "cli-run-review-show-5", "runner-continue-review-show-4"),
  ],
  "continue review report": [
    inherit(runReviewContracts["run review report"], "cli-run-review-report-1", "runner-continue-review-report-1"),
  ],
  "continue review update": [
    inherit(runReviewContracts["run review update"], "cli-run-review-update-1", "runner-continue-review-update-1"),
  ],
  "continue review comment add": [
    inherit(runReviewContracts["run review comment add"], "cli-run-review-comment-add-1", "runner-continue-review-comment-add-1"),
  ],
  "continue review comment update": [
    inherit(runReviewContracts["run review comment update"], "cli-run-review-comment-update-1", "runner-continue-review-comment-update-1"),
  ],
  "continue review comment delete": [
    inherit(runReviewContracts["run review comment delete"], "cli-run-review-comment-delete-1", "runner-continue-review-comment-delete-1"),
  ],
  "continue review submit": [
    inherit(runReviewContracts["run review submit"], "cli-run-review-submit-1", "runner-continue-review-submit-1"),
  ],
  "continue review create": [
    inherit(runReviewContracts["run review create"], "cli-run-review-create-1", "runner-continue-review-create-1"),
  ],
  "continue report": [
    inherit(runStateContracts["run report"], "cli-run-report-1", "runner-continue-report-1"),
    inherit(runStateContracts["run report"], "cli-run-report-2", "runner-continue-report-2"),
  ],
  "continue external add": [
    inherit(runWorkContracts["run external add"], "cli-run-external-add-1", "runner-continue-external-add-1"),
    inherit(runWorkContracts["run external add"], "cli-run-external-add-2", "runner-continue-external-add-2"),
  ],
  "continue outputs update": [
    inherit(runStateContracts["run outputs update"], "cli-run-outputs-update-1", "runner-continue-outputs-update-1"),
  ],
  "continue finish": [
    inherit(runStateContracts["run finish"], "cli-run-finish-1", "runner-continue-finish-1"),
  ],
  "continue abandon": [
    inherit(runStateContracts["run abandon"], "cli-run-abandon-1", "runner-continue-abandon-1"),
  ],
};
