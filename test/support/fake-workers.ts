import type { WorkerRuntime } from "../../src/context_control/runtime.js";
import type { ProcessIdentity } from "../../src/context_control/review-process.js";
import type { RewindWorker } from "../../src/context_control/types.js";

/** Observations supplied by a scenario; does not simulate kernel ownership rules. */
export class FakeWorkers implements WorkerRuntime {
  readonly pid = 90001;
  readonly platform: NodeJS.Platform = "linux";
  readonly identities = new Map<number, ProcessIdentity>();
  readonly stopped: RewindWorker[] = [];
  readonly terminated: number[] = [];
  captureIdentity = async (pid: number) => structuredClone(this.identities.get(pid));
  captureGroup = async (group: number) => structuredClone([...this.identities.values()].filter(p => p.group === group));
  stop = async (worker: RewindWorker) => { this.stopped.push(structuredClone(worker)); };
  terminate = async (pid: number) => { this.terminated.push(pid); };
}
