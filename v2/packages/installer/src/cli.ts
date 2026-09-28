#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { access, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  agentDefinitions,
  agentIds,
} from "../../orchestration/src/agents/definitions";
import type {
  AgentId,
  CanonicalSkill,
  RuntimeId,
} from "../../orchestration/src/runtimes/types";
import { vscodeCopilotRuntime } from "../../orchestration/src/runtimes/vscode-copilot";
import { type AvailableModel, OpenCodeDiscovery } from "./discovery/opencode";
import {
  installGlobalVscode,
  installLocalVscode,
  installSharedRuntime,
  uninstallGlobalVscode,
  uninstallLocalVscode,
} from "./index";
import { buildMcpBundle } from "./mcp-bundle";
import {
  applyOpenCodeInstall,
  type InstallationPlan,
  planOpenCodeInstall,
  type RuntimeInstallPlan,
  uninstallOpenCode,
} from "./runtimes/opencode-installer";
import { type MenuOption, TerminalWizard, WizardCancelledError } from "./tui";
import { resolveVscodeMcpConfigPath } from "./vscode/paths";
import {
  compatibleProviders,
  type ModelProfile,
  modelProfileDescriptions,
  OpenCodeModelResolver,
} from "./wizard/model-profiles";
import { validateRuntimeSelection } from "./wizard/runtime-selection";
import { scopeSelectionOptions } from "./wizard/scope-selection";

const root = resolve(import.meta.dir, "../../..");
const orchestrationRoot = join(root, "packages/orchestration");
const dataRoot = () => {
  if (process.platform === "darwin")
    return join(homedir(), "Library/Application Support/Pulso/v2");
  if (process.platform === "win32")
    return join(
      process.env.LOCALAPPDATA ?? join(homedir(), "AppData/Local"),
      "Pulso/v2",
    );
  return join(
    process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"),
    "pulso/v2",
  );
};

const choose = async <T extends string>(
  terminal: TerminalWizard,
  prompt: string,
  options: MenuOption<T>[],
  title = "Elige una opción",
  initialIndex = 0,
) => {
  return terminal.select(title, prompt, options, initialIndex);
};

const readSkills = async () => {
  const path = join(orchestrationRoot, "skills");
  const entries = await readdir(path, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const content = await readFile(
          join(path, entry.name, "SKILL.md"),
          "utf8",
        );
        const description = content
          .match(/^description:\s*(.+)$/m)?.[1]
          ?.trim();
        return { id: entry.name, description: description ?? "" };
      }),
  ).then((skills) =>
    skills.sort((left, right) => left.id.localeCompare(right.id)),
  );
};

const readCanonicalSkills = async (): Promise<CanonicalSkill[]> => {
  const skills = await readSkills();
  return Promise.all(
    skills.map(async ({ id }) => ({
      id: id as CanonicalSkill["id"],
      content: await readFile(
        join(orchestrationRoot, "skills", id, "SKILL.md"),
        "utf8",
      ),
    })),
  );
};

const install = async (terminal: TerminalWizard): Promise<boolean> => {
  const selectedRuntimes = await terminal.multiSelect<RuntimeId>(
    "Paso 1 · Runtimes",
    "Selecciona los runtimes para Pulso.",
    [
      { value: "vscode-copilot", label: "VS Code / GitHub Copilot" },
      { value: "opencode", label: "OpenCode" },
    ],
    ["vscode-copilot"],
  );
  validateRuntimeSelection(selectedRuntimes);
  const scope = await choose(
    terminal,
    "¿Dónde quieres disponer de Pulso?",
    scopeSelectionOptions,
    "Paso 2 · Alcance",
  );
  const homeDir = homedir();
  let workspace: string | undefined;
  const mcpConfigPath =
    scope === "global" && selectedRuntimes.includes("vscode-copilot")
      ? await resolveVscodeMcpConfigPath()
      : undefined;

  if (
    scope === "local" &&
    (selectedRuntimes.includes("vscode-copilot") ||
      selectedRuntimes.includes("opencode"))
  ) {
    workspace = resolve(
      await terminal.text("Ruta del repositorio/workspace", process.cwd()),
    );
    await access(workspace);
  }

  const warnings: string[] = [];
  let openCodeInstallOptions:
    | Parameters<typeof planOpenCodeInstall>[0]
    | undefined;
  let openCodePlan: Awaited<ReturnType<typeof planOpenCodeInstall>> | undefined;
  let activeRuntimes = [...selectedRuntimes];
  if (activeRuntimes.includes("opencode")) {
    const discovery = new OpenCodeDiscovery();
    const probe = await terminal.withProgress(
      "Detectando OpenCode y validando capacidades...",
      () => discovery.probe(),
      "OpenCode detectado",
    );
    if (!probe.executable) {
      console.log(
        "OpenCode was not detected.\n\nPulso cannot configure the OpenCode runtime until OpenCode is installed and available in PATH.",
      );
      const decision = await choose(
        terminal,
        "¿Cómo quieres continuar?",
        [
          {
            value: "continue" as const,
            label: "Continuar con los runtimes restantes",
          },
          { value: "cancel" as const, label: "Cancelar" },
        ],
        "OpenCode no disponible",
      );
      if (decision === "cancel") return false;
      activeRuntimes = activeRuntimes.filter(
        (runtime) => runtime !== "opencode",
      );
    } else if (
      !probe.capabilities.agentConfiguration ||
      !probe.capabilities.skills ||
      !probe.capabilities.mcp ||
      !probe.capabilities.modelsCommand
    ) {
      throw new Error(
        `OPENCODE_UNSUPPORTED_CAPABILITIES:${JSON.stringify(probe.capabilities)}`,
      );
    } else {
      const executable = probe.executable;
      let catalog: AvailableModel[] = [];
      try {
        catalog = await terminal.withProgress(
          "Descubriendo modelos disponibles...",
          () => discovery.models(executable),
          "Catálogo de modelos listo",
        );
      } catch (error) {
        warnings.push(
          `No se pudo descubrir el catálogo de modelos: ${error instanceof Error ? error.message : String(error)}. Solo estará disponible Inherited.`,
        );
      }
      // This is diagnostic only; provider choices come exclusively from the model catalog.
      try {
        await discovery.diagnostics(probe.executable);
      } catch {
        /* provider diagnostics never block setup */
      }
      const resolver = new OpenCodeModelResolver(catalog);
      const possibleProviders = compatibleProviders
        .map(
          (provider) =>
            catalog.find(
              (model) =>
                model.provider.toLowerCase().replace(/[-_]/g, " ") === provider,
            )?.provider,
        )
        .filter(
          (provider): provider is string =>
            provider !== undefined &&
            ["luna", "terra", "sol"].some((family) =>
              resolver
                .providersFor(family as "luna" | "terra" | "sol")
                .includes(provider),
            ),
        );
      const providers = [...new Set(possibleProviders)].sort();
      const provider =
        providers.length > 1
          ? await choose(
              terminal,
              "Elige el proveedor preferido para los perfiles Pulso.",
              providers.map((id) => ({ value: id, label: id })),
              "Proveedor para perfiles",
            )
          : providers[0];
      const profileOrder: Array<Exclude<ModelProfile, "custom">> = [
        "inherited",
        "economic",
        "balanced",
        "maximum",
      ];
      const selectableProfiles = profileOrder.filter((profile) =>
        resolver.presetAvailable(profile, provider),
      );
      const profileOptions: MenuOption<ModelProfile>[] = selectableProfiles.map(
        (profile) => ({
          value: profile,
          label: (
            {
              inherited: "Inherited",
              economic: "Economic",
              balanced: "Balanced",
              maximum: "Maximum performance",
            } as const
          )[profile],
          description: modelProfileDescriptions[profile],
        }),
      );
      if (catalog.length)
        profileOptions.push({
          value: "custom",
          label: "Custom",
          description: modelProfileDescriptions.custom,
        });
      if (!providers.length)
        warnings.push(
          "No se detectaron familias OpenAI/Copilot compatibles; solo Inherited está disponible. Conecta OpenAI o GitHub Copilot en OpenCode y vuelve a configurar Pulso.",
        );
      const selectedProfile = await choose(
        terminal,
        "Configura los modelos de los agentes OpenCode.",
        profileOptions,
        "OpenCode agent models",
      );
      const modelConfig =
        selectedProfile === "custom"
          ? resolver.custom(
              await (async () => {
                const agents = [
                  "pulso",
                  "planner",
                  "explorer",
                  "executor",
                  "verifier",
                  "security-auditor",
                ] as AgentId[];
                const assignments = {} as Record<AgentId, string | null>;
                const modelOptions: MenuOption<string>[] = [
                  {
                    value: "__inherit__",
                    label: "Inherited",
                    description: "Usa el modelo de la sesión.",
                  },
                  ...catalog.map((model) => ({
                    value: model.id,
                    label: model.id,
                    description: `${model.provider}${model.displayName ? ` · ${model.displayName}` : ""}`,
                  })),
                ];
                for (const agent of agents) {
                  const value = await terminal.searchableSelect(
                    "Custom · Modelos por agente",
                    `Modelo para ${agent}`,
                    modelOptions,
                  );
                  assignments[agent] = value === "__inherit__" ? null : value;
                }
                return assignments;
              })(),
            )
          : resolver.resolveProfile(
              selectedProfile as Exclude<ModelProfile, "custom">,
              provider,
            );
      openCodeInstallOptions = {
        scope,
        workspace,
        homeDir,
        executable: probe.executable,
        mcpCommand: [
          process.execPath,
          join(dataRoot(), "pulso-capabilities-mcp.js"),
        ],
        version: probe.version,
        modelConfig,
        skills: await readCanonicalSkills(),
        discovery,
      };
      openCodePlan = await planOpenCodeInstall(openCodeInstallOptions);
    }
  }

  if (!activeRuntimes.length) {
    console.log(
      "No quedó ningún runtime seleccionado; no se aplicaron cambios.",
    );
    return false;
  }

  let vscodePreflight: { installedFiles: string[] } | undefined;
  if (activeRuntimes.includes("vscode-copilot")) {
    vscodePreflight =
      scope === "global"
        ? await installGlobalVscode({
            homeDir,
            mcpConfigPath:
              mcpConfigPath ?? (await resolveVscodeMcpConfigPath()),
            orchestrationRoot,
            dataRoot: dataRoot(),
            runtimeExecutable: process.execPath,
            mcpBundle: "",
            dryRun: true,
          })
        : await installLocalVscode({
            workspace: workspace ?? process.cwd(),
            orchestrationRoot,
            runtimeExecutable: process.execPath,
            mcpBundlePath: join(dataRoot(), "pulso-capabilities-mcp.js"),
            dryRun: true,
          });
  }

  const canonicalSkills =
    openCodeInstallOptions?.skills ?? (await readCanonicalSkills());
  const runtimePlans: RuntimeInstallPlan[] = [];
  if (activeRuntimes.includes("vscode-copilot")) {
    const agentRoot =
      scope === "local"
        ? join(workspace ?? process.cwd(), ".github", "agents")
        : join(homeDir, ".copilot", "agents");
    const skillRoot =
      scope === "local"
        ? join(workspace ?? process.cwd(), ".github", "skills")
        : join(homeDir, ".copilot", "skills");
    const assets = [
      ...agentIds.map((id) => {
        const rendered = vscodeCopilotRuntime.renderAgent(agentDefinitions[id]);
        return {
          path: join(agentRoot, rendered.path),
          content: rendered.content,
          sha256: createHash("sha256").update(rendered.content).digest("hex"),
        };
      }),
      ...canonicalSkills.map((skill) => {
        const rendered = vscodeCopilotRuntime.renderSkill(skill);
        return {
          path: join(skillRoot, rendered.path),
          content: rendered.content,
          sha256: createHash("sha256").update(rendered.content).digest("hex"),
        };
      }),
    ];
    const mcpBundlePath = join(dataRoot(), "pulso-capabilities-mcp.js");
    const artifact = vscodeCopilotRuntime.buildRuntimeConfig({
      scope,
      mcpCommand: [process.execPath, mcpBundlePath],
    })[0];
    if (!artifact) throw new Error("VSCODE_CONFIG_RENDERER_EMPTY");
    const configPath =
      scope === "local"
        ? join(workspace ?? process.cwd(), artifact.path)
        : (mcpConfigPath ?? (await resolveVscodeMcpConfigPath()));
    const config = JSON.parse(artifact.content) as {
      servers?: Record<string, unknown>;
    };
    const configMutation = {
      path: configPath,
      key: "servers.pulso",
      value: config.servers?.pulso,
    };
    runtimePlans.push({
      runtime: "vscode-copilot",
      assets,
      config: [configMutation],
    });
  }
  if (openCodePlan) runtimePlans.push(...openCodePlan.runtimes);
  const installationPlan: InstallationPlan = {
    runtimes: runtimePlans,
    scope,
    fileMutations: runtimePlans.flatMap((runtime) => runtime.assets),
    configMutations: runtimePlans.flatMap((runtime) => runtime.config),
    warnings: warnings.map((message) => ({ code: "INSTALL_WARNING", message })),
  };
  const opencodeModels = openCodeInstallOptions?.modelConfig
    ? Object.entries(openCodeInstallOptions.modelConfig.agents)
        .map(([agent, model]) => `  ${agent}: ${model ?? "inherit"}`)
        .join("\n")
    : "";
  const plannedPaths = [
    ...installationPlan.fileMutations.map((asset) => `  ${asset.path}`),
    ...installationPlan.configMutations.map(
      (mutation) => `  ${mutation.path}#${mutation.key}`,
    ),
  ];
  const mcpDependencyNotice =
    "Si faltan dependencias para empaquetar Capabilities MCP, se descargarán versiones fijadas desde npm después de confirmar y se borrará el directorio temporal.";

  const confirmation = await choose(
    terminal,
    `Pulso installation\n\nScope\n  ${scope === "global" ? "Global" : `Local (${workspace})`}\n\nRuntimes\n${activeRuntimes.map((runtime) => `  ${runtime}${runtime === "opencode" && openCodeInstallOptions?.version ? ` ${openCodeInstallOptions.version}` : ""}`).join("\n")}${vscodePreflight ? `\n  VS Code preflight: ${vscodePreflight.installedFiles.length} managed assets` : ""}${openCodePlan ? `\n\nOpenCode models\n  Profile: ${openCodeInstallOptions?.modelConfig?.profile}\n${opencodeModels}` : ""}\n\nFiles and configuration\n${plannedPaths.map((path) => path).join("\n")}${warnings.length ? `\n\nWarnings\n${warnings.map((warning) => `  ${warning}`).join("\n")}` : ""}\n\nDependencies\n  ${mcpDependencyNotice}\n\nApply installation?`,
    [
      { value: "install" as const, label: "Instalar Pulso" },
      { value: "cancel" as const, label: "Cancelar" },
    ],
    "Revisa la configuración",
    1,
  );
  if (confirmation === "cancel") {
    console.log("Instalación cancelada; no se escribieron cambios.");
    return false;
  }

  const bundle = activeRuntimes.includes("vscode-copilot")
    ? await terminal.withProgress(
        "Verificando dependencias, descargando las que falten y empaquetando MCP...",
        // VS Code retains its legacy MCP runtime and is not part of OpenCode's build unit.
        () => buildMcpBundle("development"),
        "Bundle Capabilities MCP listo",
      )
    : undefined;

  let totalFiles = 0;
  if (activeRuntimes.includes("vscode-copilot")) {
    if (!bundle) throw new Error("INSTALL_MCP_BUNDLE_MISSING");
    let result: { installedFiles: string[] };
    if (scope === "global") {
      if (!mcpConfigPath) throw new Error("VSCODE_MCP_CONFIG_PATH_UNRESOLVED");
      result = await terminal.withProgress(
        "Instalando agentes, skills y MCP para VS Code...",
        () =>
          installGlobalVscode({
            homeDir,
            mcpConfigPath,
            orchestrationRoot,
            dataRoot: dataRoot(),
            runtimeExecutable: process.execPath,
            mcpBundle: bundle,
          }),
        "VS Code instalado",
      );
    } else {
      const runtimePath = await terminal.withProgress(
        "Registrando el bundle MCP compartido...",
        () =>
          installSharedRuntime({
            dataRoot: dataRoot(),
            mcpBundle: bundle,
            homeDir,
          }),
        "Bundle MCP registrado",
      );
      result = await terminal.withProgress(
        "Instalando agentes, skills y MCP para VS Code...",
        () =>
          installLocalVscode({
            workspace: workspace ?? process.cwd(),
            orchestrationRoot,
            runtimeExecutable: process.execPath,
            mcpBundlePath: runtimePath,
          }),
        "VS Code instalado",
      );
    }
    totalFiles += result.installedFiles.length;
  }
  if (
    activeRuntimes.includes("opencode") &&
    openCodePlan &&
    openCodeInstallOptions
  ) {
    const installPlan = openCodePlan;
    const installOptions = openCodeInstallOptions;
    const result = await terminal.withProgress(
      "Instalando agentes, skills y configuración OpenCode...",
      () => applyOpenCodeInstall(installOptions, installPlan),
      "OpenCode instalado",
    );
    totalFiles += result.installedFiles.length;
    try {
      const validation = await terminal.withProgress(
        "Validando conexión MCP de OpenCode...",
        () => new OpenCodeDiscovery().validateMcp(installOptions.executable),
        "Validación MCP completada",
      );
      if (!validation.ok)
        console.warn(
          "OpenCode MCP validation had a runtime warning; config and Pulso MCP entry were written.",
        );
    } catch {
      console.warn(
        "OpenCode MCP validation was unavailable; config and Pulso MCP entry were written.",
      );
    }
  }
  console.log(
    `Pulso instalado correctamente (${totalFiles} archivos administrados).`,
  );
  if (activeRuntimes.includes("vscode-copilot"))
    console.log("Reinicia VS Code para cargar agentes, skills y MCP.");
  if (activeRuntimes.includes("opencode"))
    console.log(
      "En OpenCode, usa /details para alternar el detalle de las tools.",
    );
  return true;
};

const uninstall = async (terminal: TerminalWizard): Promise<boolean> => {
  const runtimes = await terminal.multiSelect<RuntimeId>(
    "Desinstalar Pulso",
    "Selecciona los runtimes que quieres retirar.",
    [
      { value: "vscode-copilot", label: "VS Code / GitHub Copilot" },
      { value: "opencode", label: "OpenCode" },
    ],
    ["vscode-copilot", "opencode"],
  );
  if (!runtimes.length) return false;
  const scope = await choose(
    terminal,
    "¿Qué instalación quieres retirar?",
    [
      { value: "global" as const, label: "Global (perfil de VS Code)" },
      { value: "local" as const, label: "Local (workspace)" },
    ],
    "Desinstalar Pulso",
  );
  const confirmation = await choose(
    terminal,
    "Solo se eliminarán los archivos de Pulso que no hayan sido editados.",
    [
      { value: "remove" as const, label: "Desinstalar" },
      { value: "cancel" as const, label: "Conservar instalación" },
    ],
    "Confirma la desinstalación",
    1,
  );
  if (confirmation === "cancel") {
    console.log("Desinstalación cancelada.");
    return false;
  }
  const workspace =
    scope === "local"
      ? resolve(await terminal.text("Ruta del workspace", process.cwd()))
      : undefined;
  const conflicts: string[] = [];
  const vscodeMcpConfig =
    scope === "global" && runtimes.includes("vscode-copilot")
      ? await resolveVscodeMcpConfigPath()
      : undefined;
  const preflightVscode = runtimes.includes("vscode-copilot")
    ? scope === "global"
      ? await uninstallGlobalVscode({
          dataRoot: dataRoot(),
          homeDir: homedir(),
          mcpConfigPath: vscodeMcpConfig ?? "",
          dryRun: true,
        })
      : await uninstallLocalVscode(workspace ?? process.cwd(), true)
    : undefined;
  const preflightOpenCode = runtimes.includes("opencode")
    ? await uninstallOpenCode({
        scope,
        workspace,
        homeDir: homedir(),
        dryRun: true,
      })
    : undefined;
  conflicts.push(
    ...(preflightVscode?.conflicts ?? []),
    ...(preflightOpenCode?.conflicts ?? []),
  );
  if (conflicts.length) {
    throw new Error(
      [
        "No se eliminó ningún archivo porque hay cambios manuales o conflictos:",
        ...conflicts.map((path) => `  ${path}`),
      ].join("\n"),
    );
  }
  const removed: string[] = [];
  if (runtimes.includes("vscode-copilot")) {
    const result =
      scope === "global"
        ? await uninstallGlobalVscode({
            dataRoot: dataRoot(),
            homeDir: homedir(),
            mcpConfigPath: vscodeMcpConfig ?? "",
          })
        : await uninstallLocalVscode(workspace ?? process.cwd());
    removed.push(...result.removedFiles);
  }
  if (runtimes.includes("opencode")) {
    const result = await uninstallOpenCode({
      scope,
      workspace,
      homeDir: homedir(),
    });
    removed.push(...result.removedFiles);
  }
  console.log(
    `Desinstalación completada. Archivos retirados: ${removed.length}.`,
  );
  return true;
};

const help = () => {
  console.log(
    "Pulso Installer — instalación segura de Pulso para VS Code\n\nUso:\n  bun run packages/installer/src/cli.ts [install|uninstall]\n\nSin argumento abre el Wizard interactivo.",
  );
};

const command = process.argv[2];
if (command === "--help" || command === "-h") help();
else {
  const terminal = new TerminalWizard();
  let finished = false;
  while (!finished) {
    try {
      const completed =
        command === "uninstall"
          ? await uninstall(terminal)
          : await install(terminal);
      if (!completed) break;
      const next = await choose(
        terminal,
        "La operación terminó correctamente.",
        [
          { value: "exit" as const, label: "Salir del instalador" },
          {
            value: "again" as const,
            label:
              command === "uninstall"
                ? "Retirar otra instalación"
                : "Instalar Pulso en otro alcance",
          },
        ],
        "Instalador completado",
      );
      finished = next === "exit";
    } catch (error) {
      if (error instanceof WizardCancelledError) break;
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      const next = await choose(
        terminal,
        message,
        [
          { value: "restart" as const, label: "Volver al inicio" },
          { value: "exit" as const, label: "Salir del instalador" },
        ],
        "No se pudo completar",
      );
      finished = next === "exit";
      if (!finished) process.exitCode = 0;
    }
  }
}
