import type { ViewServiceState, ViewServiceStateStore } from "../../src/view/service.js";

export class MemoryViewState implements ViewServiceStateStore {
  private readonly states = new Map<string, ViewServiceState>();
  read = async (path: string) => structuredClone(this.states.get(path));
  write = async (path: string, value: ViewServiceState) => { this.states.set(path, structuredClone(value)); };
  clear = async (path: string, pid?: number) => {
    if (pid !== undefined && this.states.get(path)?.pid !== pid) return;
    this.states.delete(path);
  };
}
