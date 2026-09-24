import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { tool } from "@opencode-ai/plugin"
import stateFiles from "../lib/pulso-file-state.js"

function gitPath(directory, ...args) {
  return execFileSync("git", ["rev-parse", ...args], { cwd: directory, encoding: "utf8" }).trim()
}

function safeExcludePath(directory) {
  const commonDirectory = fs.realpathSync(gitPath(directory, "--path-format=absolute", "--git-common-dir"))
  const unresolved = path.resolve(directory, gitPath(directory, "--git-path", "info/exclude"))
  const exclude = path.join(fs.realpathSync(path.dirname(unresolved)), path.basename(unresolved))
  const relative = path.relative(commonDirectory, exclude)
  if (relative !== path.join("info", "exclude")) throw new Error("Git exclude path is outside the local repository metadata.")
  let current = commonDirectory
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("Refusing a symbolic Git metadata path.")
  }
  return exclude
}

function pulsoConfig(previous, artifacts) {
  const match = previous.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  const body = match ? previous.slice(match[0].length).replace(/^\r?\n/, "") : previous
  const existing = match ? match[1].split(/\r?\n/) : []
  const preserved = existing.filter((line) => !/^\s*(?:schema_version|artifacts):/.test(line))
  const frontmatter = ["schema_version: 1", `artifacts: ${artifacts}`, ...preserved]
  const fallback = "# Pulso Project Configuration\n\n## Project Rules\n"
  return `---\n${frontmatter.join("\n")}\n---\n\n${body || fallback}`
}

function writeAtomic(file, content) {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`)
  try {
    fs.writeFileSync(temporary, content, { mode: 0o600, flag: "wx" })
    fs.renameSync(temporary, file)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}

export default tool({
  description: "Persist whether Pulso coordination artifacts stay local or are versioned in Git.",
  args: {
    artifacts: tool.schema.enum(["tracked", "untracked"]),
  },
  async execute({ artifacts }, context) {
    if (context.agent !== "pulso") throw new Error("Only the Pulso primary agent can configure artifact tracking.")
    const configFile = path.join(context.directory, "PULSO.md")
    if (fs.existsSync(configFile) && fs.lstatSync(configFile).isSymbolicLink()) throw new Error("Refusing a symbolic PULSO.md path.")
    const excludeFile = safeExcludePath(context.directory)
    const previousConfig = fs.existsSync(configFile) ? fs.readFileSync(configFile, "utf8") : ""

    stateFiles.withFileLock(configFile, () => writeAtomic(configFile, pulsoConfig(previousConfig, artifacts)))
    stateFiles.withFileLock(excludeFile, () => {
      const previous = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, "utf8") : ""
      const lines = previous.split(/\r?\n/).filter((line) => line !== ".pulso/")
      while (lines.length && lines.at(-1) === "") lines.pop()
      if (artifacts === "untracked") lines.push(".pulso/")
      const next = lines.length ? `${lines.join("\n")}\n` : ""
      if (next !== previous) writeAtomic(excludeFile, next)
    })

    return JSON.stringify({ artifacts, status: "configured" })
  },
})
