"use strict";

const fs = require("fs");
const path = require("path");

function pulsoConfiguration(directory) {
  const file = path.join(directory, "PULSO.md");
  try {
    if (!fs.lstatSync(file).isFile()) return null;
    const match = fs.readFileSync(file, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) return null;
    const values = {};
    for (const line of match[1].split(/\r?\n/)) {
      if (!line.trim() || /^\s*#/.test(line)) continue;
      const field = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(\S.*?)\s*$/);
      if (!field || Object.hasOwn(values, field[1])) return null;
      values[field[1]] = field[2];
    }
    return values.schema_version === "1" && ["tracked", "untracked"].includes(values.artifacts) ? values : null;
  } catch {
    return null;
  }
}

function isPulsoInitialized(directory) {
  return Boolean(pulsoConfiguration(directory));
}

function projectRules(directory) {
  const file = path.join(directory, "PULSO.md");
  try {
    const text = fs.readFileSync(file, "utf8");
    const heading = /^## Project Rules\s*$/m.exec(text);
    if (!heading) return "";
    const body = text.slice(heading.index + heading[0].length).replace(/^\r?\n/, "");
    const nextHeading = /^##\s+/m.exec(body);
    return (nextHeading ? body.slice(0, nextHeading.index) : body).trim();
  } catch {
    return "";
  }
}

function workerContract(task) {
  const scope = task.scope && typeof task.scope === "object" ? task.scope : task;
  return {
    schema_version: 1,
    outcome: task.objective || task.title,
    scope: {
      allowed_paths: Array.isArray(scope.allowed_paths) ? scope.allowed_paths : [],
      excluded_paths: Array.isArray(scope.excluded_paths) ? scope.excluded_paths : [],
    },
    acceptance_criteria: task.acceptance_criteria || [],
    validation: task.validation || [],
    skills: task.skills || [],
    skill_constraints: task.skill_constraints || [],
    project_rules: task.project_rules || "",
    experience: task.experience || { memories: [], preferences: [] },
  };
}

module.exports = { pulsoConfiguration, isPulsoInitialized, projectRules, workerContract };
