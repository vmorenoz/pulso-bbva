import type { RuntimeExecutionBinding } from "../contracts/runtime-execution";
import type { RuntimeWorkAdapter } from "./runtime-work-adapter";

export class RuntimeReconciler {
  constructor(private readonly adapter: RuntimeWorkAdapter) {}

  run(): Promise<RuntimeExecutionBinding[]> {
    return this.adapter.reconcile();
  }
}
