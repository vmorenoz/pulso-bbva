export interface RuntimeIdentity {
  provider: string;
  instanceId?: string;
}

export interface RuntimeCapabilities {
  stableExecutionId: boolean;
  stableSessionId: boolean;
  lifecycleEvents: boolean;
  cancellationEvents: boolean;
  automaticHeartbeat: boolean;
}
