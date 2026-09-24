import type {
  Assignment,
  Execution,
  ExecutionService,
  RecoveryService,
  Store,
  WorkItem,
  WorkLease,
  WorkService,
} from "../../../../working-system/src/domain";
import type { RuntimeExecutionReference } from "../contracts/runtime-reference";
import type { WorkingSystemGateway } from "../ports/working-system-gateway";

export class ExecutionCoordinator implements WorkingSystemGateway {
  constructor(
    private readonly store: Store,
    private readonly workService: WorkService,
    private readonly executionService: ExecutionService,
    private readonly recoveryService: RecoveryService,
  ) {}

  assign(workItemId: string, assigneeId: string): Promise<Assignment> {
    return this.workService.assign(workItemId, assigneeId);
  }

  async startExecution(input: {
    workItemId: string;
    executorId: string;
    runtime: RuntimeExecutionReference;
  }): Promise<{ execution: Execution; lease: WorkLease }> {
    const started = await this.executionService.start(
      input.workItemId,
      input.executorId,
    );
    const state = await this.store.read();
    const execution = state.executions.find(
      (candidate) => candidate.id === started.executionId,
    );
    const lease = state.leases.find(
      (candidate) => candidate.id === started.leaseId,
    );
    if (!execution || !lease)
      throw new Error("Execution authority was not persisted");
    return { execution, lease };
  }

  heartbeat(executionId: string, leaseId: string, fencingToken: number) {
    return this.executionService.heartbeat(executionId, leaseId, fencingToken);
  }

  complete(
    executionId: string,
    leaseId: string,
    fencingToken: number,
    result?: string,
  ) {
    return this.executionService.complete(
      executionId,
      leaseId,
      result,
      fencingToken,
    );
  }

  fail(
    executionId: string,
    leaseId: string,
    fencingToken: number,
    reason: string,
  ) {
    return this.executionService.fail(
      executionId,
      leaseId,
      reason,
      false,
      fencingToken,
    );
  }

  cancel(
    executionId: string,
    leaseId: string,
    fencingToken: number,
    _reason?: string,
  ) {
    return this.executionService.cancel(executionId, leaseId, fencingToken);
  }

  suspend(
    executionId: string,
    leaseId: string,
    fencingToken: number,
    target: "blocked" | "waiting",
    reason?: string,
  ) {
    return this.executionService.suspend(
      executionId,
      leaseId,
      target,
      reason,
      fencingToken,
    );
  }

  revoke(input: { leaseId: string; reason: string }) {
    return this.executionService.revokeLease(input);
  }

  recover() {
    return this.recoveryService.recover();
  }

  async inspect(executionId: string) {
    const state = await this.store.read();
    const execution = state.executions.find(
      (candidate) => candidate.id === executionId,
    );
    if (!execution) throw new Error(`Execution not found: ${executionId}`);
    const lease = state.leases.find(
      (candidate) => candidate.executionId === executionId,
    );
    if (!lease)
      throw new Error(`Lease not found for execution: ${executionId}`);
    return { execution, lease };
  }

  async inspectItem(itemId: string) {
    const state = await this.store.read();
    const item = state.items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error(`WorkItem not found: ${itemId}`);
    return {
      items: [item] as WorkItem[],
      assignments: state.assignments.filter(
        (assignment) => assignment.workItemId === itemId,
      ),
    };
  }

  async snapshot(workId: string) {
    const snapshot = await this.workService.snapshot(workId);
    return { items: snapshot.items, assignments: snapshot.assignments };
  }
}
