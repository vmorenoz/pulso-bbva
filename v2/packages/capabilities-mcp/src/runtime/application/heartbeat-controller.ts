import type { RuntimeExecutionBinding } from "../contracts/runtime-execution";
import type { RuntimeWorkAdapter } from "./runtime-work-adapter";

export class HeartbeatController {
  private timers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(private readonly adapter: RuntimeWorkAdapter) {}

  heartbeat(bindingId: string): Promise<RuntimeExecutionBinding> {
    return this.adapter.heartbeat(bindingId);
  }

  start(bindingId: string): void {
    this.stop(bindingId);
    const timer = setInterval(() => {
      void this.adapter.heartbeat(bindingId).catch(() => this.stop(bindingId));
    }, this.adapter.heartbeatPolicy.heartbeatIntervalMs);
    this.timers.set(bindingId, timer);
  }

  stop(bindingId: string): void {
    const timer = this.timers.get(bindingId);
    if (timer) clearInterval(timer);
    this.timers.delete(bindingId);
  }

  stopAll(): void {
    for (const bindingId of this.timers.keys()) this.stop(bindingId);
  }
}
