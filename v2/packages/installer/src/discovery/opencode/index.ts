import { spawn } from "node:child_process";
import { delimiter } from "node:path";

export interface OpenCodeCapabilities {
  agentConfiguration: boolean;
  agentModelOverride: boolean;
  skills: boolean;
  mcp: boolean;
  modelsCommand: boolean;
}
export interface OpenCodeProbe {
  executable: string | null;
  version?: string;
  supported: boolean;
  capabilities: OpenCodeCapabilities;
}
export interface AvailableModel {
  id: string;
  provider: string;
  modelId: string;
  displayName?: string;
}
export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}
export type CommandRunner = (
  executable: string,
  args: string[],
  timeoutMs?: number,
) => Promise<CommandResult>;

export const runCommand: CommandRunner = (
  executable,
  args,
  timeoutMs = 10_000,
) =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });

const findOnPath = async (
  pathValue = process.env.PATH ?? "",
  runner = runCommand,
) => {
  const candidates =
    process.platform === "win32"
      ? ["opencode.exe", "opencode.cmd", "opencode"]
      : ["opencode"];
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const candidate of candidates) {
      const executable = `${directory}/${candidate}`;
      try {
        const result = await runner(executable, ["--version"], 5_000);
        if (result.code === 0) return executable;
      } catch {
        /* keep searching PATH */
      }
    }
  }
  return null;
};

const parseVersion = (source: string) =>
  source.match(/(?:^|\s)v?(\d+\.\d+\.\d+(?:-[\w.-]+)?)/)?.[1];

export const parseModelCatalog = (source: string): AvailableModel[] => {
  const seen = new Set<string>();
  const models: AvailableModel[] = [];
  for (const line of source
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)) {
    const id = line.split(/\s+/)[0] ?? "";
    const match = /^([^/\s]+)\/(.+)$/.exec(id);
    const provider = match?.[1];
    const modelId = match?.[2];
    if (!provider || !modelId || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      provider,
      modelId,
      ...(line.length > id.length
        ? { displayName: line.slice(id.length).trim() }
        : {}),
    });
  }
  return models.sort(
    (a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id),
  );
};

export class OpenCodeDiscovery {
  constructor(
    private readonly runner: CommandRunner = runCommand,
    private readonly pathValue = process.env.PATH ?? "",
  ) {}
  async probe(): Promise<OpenCodeProbe> {
    const executable = await findOnPath(this.pathValue, this.runner);
    const unavailable = {
      agentConfiguration: false,
      agentModelOverride: false,
      skills: false,
      mcp: false,
      modelsCommand: false,
    };
    if (!executable)
      return { executable: null, supported: false, capabilities: unavailable };
    const [versionResult, agent, createAgent, models, mcp, skills] =
      await Promise.all([
        this.runner(executable, ["--version"]),
        this.runner(executable, ["agent", "--help"]),
        this.runner(executable, ["agent", "create", "--help"]),
        this.runner(executable, ["models", "--help"]),
        this.runner(executable, ["mcp", "--help"]),
        this.runner(executable, ["debug", "skill", "--help"]),
      ]);
    const agentHelp = `${agent.stdout}\n${agent.stderr}`;
    const modelsHelp = `${models.stdout}\n${models.stderr}`;
    const mcpHelp = `${mcp.stdout}\n${mcp.stderr}`;
    const capabilities = {
      agentConfiguration: agent.code === 0 && /agent/i.test(agentHelp),
      agentModelOverride:
        createAgent.code === 0 &&
        /--model|provider\/model/i.test(
          `${createAgent.stdout}\n${createAgent.stderr}`,
        ),
      skills:
        skills.code === 0 &&
        /skill/i.test(`${skills.stdout}\n${skills.stderr}`),
      mcp: mcp.code === 0 && /mcp/i.test(mcpHelp),
      modelsCommand: models.code === 0 && /models/i.test(modelsHelp),
    };
    return {
      executable,
      version: parseVersion(versionResult.stdout),
      supported: Object.values(capabilities).every(Boolean),
      capabilities,
    };
  }
  async models(executable: string, refresh = false): Promise<AvailableModel[]> {
    const result = await this.runner(
      executable,
      refresh ? ["models", "--refresh"] : ["models"],
    );
    if (result.code !== 0)
      throw new Error(`OPENCODE_MODELS_FAILED:${result.stderr.trim()}`);
    return parseModelCatalog(result.stdout);
  }
  async diagnostics(executable: string) {
    const result = await this.runner(executable, ["auth", "list"]);
    return { available: result.code === 0, output: result.stdout };
  }
  async validateMcp(executable: string) {
    const result = await this.runner(executable, ["mcp", "list"]);
    return {
      ok: result.code === 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }
}
