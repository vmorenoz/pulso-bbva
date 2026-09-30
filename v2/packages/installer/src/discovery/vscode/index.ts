import { delimiter, join } from "node:path";
import { type CommandRunner, runCommand } from "../opencode";
import type { RuntimeDiscovery } from "../runtime-discovery";

export interface VsCodeProbe {
  executable: string | null;
  version?: string;
  supported: boolean;
}

export class VsCodeDiscovery implements RuntimeDiscovery<VsCodeProbe> {
  constructor(
    private readonly runner: CommandRunner = runCommand,
    private readonly pathValue = process.env.PATH ?? "",
  ) {}

  async probe(): Promise<VsCodeProbe> {
    const names =
      process.platform === "win32"
        ? ["code.cmd", "code.exe", "code"]
        : ["code"];
    for (const directory of this.pathValue.split(delimiter).filter(Boolean)) {
      for (const name of names) {
        const executable = join(directory, name);
        try {
          const result = await this.runner(executable, ["--version"], 5_000);
          if (result.code !== 0) continue;
          const version = result.stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .find((line) => /^\d+\.\d+\.\d+/.test(line));
          return {
            executable,
            ...(version ? { version } : {}),
            supported: true,
          };
        } catch {
          // Continue normal PATH lookup; no private installation paths are scanned.
        }
      }
    }
    return { executable: null, supported: false };
  }
}
