"use strict";

const fs = require("fs");
const path = require("path");

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

module.exports = { projectRules, workerContract };
