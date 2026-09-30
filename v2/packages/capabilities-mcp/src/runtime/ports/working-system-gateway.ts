import type {
  Assignment,
  Execution,
  Work,
  WorkItem,
  WorkLease,
} from "../../../../working-system/src/domain";
import type { RuntimeExecutionReference } from "../contracts/runtime-reference";

export interface WorkingSystemGateway {
  assign(workItemId: string, assigneeId: string): Promise<Assignment>;
  startExecution(input: {
    workItemId: string;
    executorId: string;
    runtime: RuntimeExecutionReference;
  }): Promise<{ execution: Execution; lease: WorkLease }>;
  heartbeat(
    executionId: string,
    leaseId: string,
    fencingToken: number,
  ): Promise<WorkLease>;
  complete(
    executionId: string,
    leaseId: string,
    fencingToken: number,
    result?: string,
  ): Promise<WorkItem>;
  fail(
    executionId: string,
    leaseId: string,
    fencingToken: number,
    reason: string,
  ): Promise<WorkItem>;
  cancel(
    executionId: string,
    leaseId: string,
    fencingToken: number,
    reason?: string,
  ): Promise<WorkItem>;
  suspend(
    executionId: string,
    leaseId: string,
    fencingToken: number,
    target: "blocked" | "waiting",
    reason?: string,
  ): Promise<WorkItem>;
  revoke(input: { leaseId: string; reason: string }): Promise<WorkLease>;
  recover(): Promise<number>;
  inspect(
    executionId: string,
  ): Promise<{ execution: Execution; lease: WorkLease }>;
  findExecutionsByRuntime(
    runtime: RuntimeExecutionReference,
  ): Promise<Array<{ execution: Execution; lease?: WorkLease }>>;
  inspectItem(
    itemId: string,
  ): Promise<{ items: WorkItem[]; assignments: Assignment[] } | undefined>;
  inspectWork(workId: string): Promise<{
    work?: Work;
    items: WorkItem[];
    assignments: Assignment[];
  }>;
  snapshot(workId: string): Promise<{
    items: WorkItem[];
    assignments: Assignment[];
  }>;
}
