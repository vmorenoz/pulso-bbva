import type { RuntimeCapabilities } from "../contracts/runtime";
import type { RuntimeExecutionReference } from "../contracts/runtime-reference";

export interface RuntimeLifecycleSource {
  readonly identity: { provider: string; instanceId?: string };
  readonly capabilities: RuntimeCapabilities;
  onStart?(
    listener: (reference: RuntimeExecutionReference) => void,
  ): () => void;
  onHeartbeat?(
    listener: (reference: RuntimeExecutionReference) => void,
  ): () => void;
  onComplete?(
    listener: (reference: RuntimeExecutionReference, result?: string) => void,
  ): () => void;
  onFail?(
    listener: (reference: RuntimeExecutionReference, reason: string) => void,
  ): () => void;
  onCancel?(
    listener: (reference: RuntimeExecutionReference, reason?: string) => void,
  ): () => void;
}
