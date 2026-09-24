export interface RuntimeDiscovery<TProbe> {
  probe(): Promise<TProbe>;
}
