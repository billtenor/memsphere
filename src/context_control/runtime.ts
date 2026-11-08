import { captureProcessGroup, captureProcessIdentity, stopRewindWorker } from "./review-process.js";
import { terminateProcessTree } from "../platform-process.js";

/** Business orchestration consumes lifecycle observations; native adapters prove OS identity. */
export type WorkerRuntime = {
  readonly pid: number;
  readonly platform: NodeJS.Platform;
  captureIdentity: typeof captureProcessIdentity;
  captureGroup: typeof captureProcessGroup;
  stop: typeof stopRewindWorker;
  terminate: (pid: number) => Promise<void>;
};
export type ContextRuntime = {
  now: () => string;
  workers: WorkerRuntime;
};
export const systemContextRuntime: ContextRuntime = {
  now: () => new Date().toISOString(),
  workers: {
    get pid() { return process.pid; },
    get platform() { return process.platform; },
    captureIdentity: captureProcessIdentity,
    captureGroup: captureProcessGroup,
    stop: stopRewindWorker,
    terminate: pid => terminateProcessTree(pid)
  }
};
