import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

type Channel = "stable" | "insiders";

const appUserDirectory = (channel: Channel) => {
  const app = channel === "stable" ? "Code" : "Code - Insiders";
  if (process.platform === "darwin")
    return join(homedir(), "Library/Application Support", app, "User");
  if (process.platform === "win32")
    return join(
      process.env.APPDATA ?? join(homedir(), "AppData/Roaming"),
      app,
      "User",
    );
  return join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    app,
    "User",
  );
};

const applicationInstalled = async (channel: Channel) => {
  const stable = channel === "stable";
  const candidates =
    process.platform === "darwin"
      ? stable
        ? [
            "/Applications/Visual Studio Code.app",
            join(homedir(), "Applications/Visual Studio Code.app"),
          ]
        : [
            "/Applications/Visual Studio Code - Insiders.app",
            join(homedir(), "Applications/Visual Studio Code - Insiders.app"),
          ]
      : process.platform === "win32"
        ? stable
          ? [
              join(
                process.env.LOCALAPPDATA ?? "",
                "Programs/Microsoft VS Code/Code.exe",
              ),
              join(
                process.env.ProgramFiles ?? "C:/Program Files",
                "Microsoft VS Code/Code.exe",
              ),
            ]
          : [
              join(
                process.env.LOCALAPPDATA ?? "",
                "Programs/Microsoft VS Code Insiders/Code - Insiders.exe",
              ),
            ]
        : stable
          ? [
              "/usr/bin/code",
              "/usr/local/bin/code",
              "/snap/bin/code",
              appUserDirectory(channel),
            ]
          : [
              "/usr/bin/code-insiders",
              "/usr/local/bin/code-insiders",
              "/snap/bin/code-insiders",
              appUserDirectory(channel),
            ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return true;
    } catch {
      // Continue through the known install locations.
    }
  }
  return false;
};

export const resolveVscodeMcpConfigPath = async () => {
  const stable = await applicationInstalled("stable");
  const insiders = await applicationInstalled("insiders");
  const channel: Channel = !stable && insiders ? "insiders" : "stable";
  return join(appUserDirectory(channel), "mcp.json");
};
