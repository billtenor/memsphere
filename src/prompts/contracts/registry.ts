import { daemonContracts } from "./daemon.js";
import { runnerContracts } from "./runner.js";
import { modelContracts } from "./model.js";
import { dataContracts } from "./data.js";
import { debugThreadIdContracts } from "./debug-thread-id.js";
import { projectContracts } from "./project.js";
import { appContracts } from "./app.js";
import { cliContracts } from "./cli.js";
import { validateContracts } from "./validate.js";
import { memoryContracts } from "./memory.js";
import { viewContracts } from "./view.js";
import { skillContracts } from "./skill.js";
import { runStateContracts } from "./run-state.js";
import { reviewerContracts } from "./reviewer.js";
import { runWorkContracts } from "./run-work.js";
import { runReviewContracts } from "./run-review.js";
import { nativeContracts } from "./native.js";
import { migrateContracts } from "./migrate.js";
import { archiveContracts } from "./archive.js";
import { runnerContinueContracts } from "./runnerContinue.js";
import { reviewerContinueContracts } from "./reviewerContinue.js";

export const commandContracts = {
  native: { ...daemonContracts, ...runnerContracts, ...modelContracts, ...dataContracts, ...debugThreadIdContracts, ...projectContracts, ...appContracts, ...cliContracts, ...validateContracts, ...memoryContracts, ...viewContracts, ...skillContracts, ...runStateContracts, ...runWorkContracts, ...runReviewContracts, ...nativeContracts, ...migrateContracts, ...archiveContracts },
  reviewer: { ...reviewerContracts },
  runnerContinue: { ...runnerContinueContracts },
  reviewerContinue: { ...reviewerContinueContracts },
};
