import type { RuntimeCapabilities } from "../contracts/runtime";
import type { RuntimeExecutionReference } from "../contracts/runtime-reference";
import type { RuntimeLifecycleSource } from "../ports/runtime-lifecycle-source";

type Listener<T extends unknown[]> = (...args: T) => void;

export class FakeRuntime implements RuntimeLifecycleSource {
  readonly identity = { provider: "test-runtime", instanceId: "fake" };
  readonly capabilities: RuntimeCapabilities = {
    stableExecutionId: true,
    stableSessionId: true,
    lifecycleEvents: true,
    cancellationEvents: true,
    automaticHeartbeat: false,
  };
  private readonly starts = new Set<Listener<[RuntimeExecutionReference]>>();
  private readonly heartbeats = new Set<
    Listener<[RuntimeExecutionReference]>
  >();
  private readonly completes = new Set<
    Listener<[RuntimeExecutionReference, string?]>
  >();
  private readonly failures = new Set<
    Listener<[RuntimeExecutionReference, string]>
  >();
  private readonly cancellations = new Set<
    Listener<[RuntimeExecutionReference, string?]>
  >();

  onStart(listener: Listener<[RuntimeExecutionReference]>) {
    return this.listen(this.starts, listener);
  }
  onHeartbeat(listener: Listener<[RuntimeExecutionReference]>) {
    return this.listen(this.heartbeats, listener);
  }
  onComplete(listener: Listener<[RuntimeExecutionReference, string?]>) {
    return this.listen(this.completes, listener);
  }
  onFail(listener: Listener<[RuntimeExecutionReference, string]>) {
    return this.listen(this.failures, listener);
  }
  onCancel(listener: Listener<[RuntimeExecutionReference, string?]>) {
    return this.listen(this.cancellations, listener);
  }

  start(reference: RuntimeExecutionReference) {
    this.emit(this.starts, reference);
  }
  heartbeat(reference: RuntimeExecutionReference) {
    this.emit(this.heartbeats, reference);
  }
  complete(reference: RuntimeExecutionReference, result?: string) {
    this.emit(this.completes, reference, result);
  }
  fail(reference: RuntimeExecutionReference, reason: string) {
    this.emit(this.failures, reference, reason);
  }
  cancel(reference: RuntimeExecutionReference, reason?: string) {
    this.emit(this.cancellations, reference, reason);
  }
  disappear() {
    this.starts.clear();
    this.heartbeats.clear();
    this.completes.clear();
    this.failures.clear();
    this.cancellations.clear();
  }
  restart() {
    return new FakeRuntime();
  }

  private listen<T extends unknown[]>(
    set: Set<Listener<T>>,
    listener: Listener<T>,
  ) {
    set.add(listener);
    return () => set.delete(listener);
  }
  private emit<T extends unknown[]>(set: Set<Listener<T>>, ...args: T) {
    for (const listener of set) listener(...args);
  }
}
