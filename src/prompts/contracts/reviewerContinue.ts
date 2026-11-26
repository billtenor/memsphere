import { reviewerContracts } from "./reviewer.js";
import { inherit } from "./types.js";

export const reviewerContinueContracts = {
  "continue report": [
    inherit(reviewerContracts["run review report"], "reviewer-run-review-report-1", "reviewer-continue-continue-report-1"),
  ],
  "continue update": [
    inherit(reviewerContracts["run review update"], "reviewer-run-review-update-1", "reviewer-continue-continue-update-1"),
  ],
  "continue comment add": [
    inherit(reviewerContracts["run review comment add"], "reviewer-run-review-comment-add-1", "reviewer-continue-continue-comment-add-1"),
  ],
  "continue comment update": [
    inherit(reviewerContracts["run review comment update"], "reviewer-run-review-comment-update-1", "reviewer-continue-continue-comment-update-1"),
  ],
  "continue comment delete": [
    inherit(reviewerContracts["run review comment delete"], "reviewer-run-review-comment-delete-1", "reviewer-continue-continue-comment-delete-1"),
  ],
  "continue list": [
    inherit(reviewerContracts["run review list"], "reviewer-run-review-list-2", "reviewer-continue-continue-list-1"),
  ],
  "continue show": [
    inherit(reviewerContracts["run review show"], "reviewer-run-review-show-2", "reviewer-continue-continue-show-1"),
    inherit(reviewerContracts["run review show"], "reviewer-run-review-show-3", "reviewer-continue-continue-show-2"),
    inherit(reviewerContracts["run review show"], "reviewer-run-review-show-4", "reviewer-continue-continue-show-3"),
  ],
  "continue submit": [
    inherit(reviewerContracts["run review submit"], "reviewer-run-review-submit-2", "reviewer-continue-continue-submit-1"),
  ],
};
