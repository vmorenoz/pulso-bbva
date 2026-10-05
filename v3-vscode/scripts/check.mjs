import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {composeResources, listFiles, parseFrontmatter, pulsoToolNames, runtimeModules} from '../src/composition.mjs';
import {extensionRoot} from './build.mjs';

export async function check({root = extensionRoot, sourceRoot} = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(manifest.displayName, 'Pulso', 'displayName público debe ser Pulso');
  const {toolDefinitions} = await import(pathToFileURL(path.join(root, 'src/tools.mjs')).href);
  assert.equal(toolDefinitions.length, 4, 'Se requieren exactamente cuatro tools Pulso');
  assert.deepEqual(toolDefinitions.map(tool => tool.name).sort(), [...pulsoToolNames].sort(), 'Nombres de tools Pulso incorrectos');
  const expected = composeResources({root: sourceRoot, toolNames: toolDefinitions.map(tool => tool.toolReferenceName || tool.name)});
  const resources = path.join(root, 'resources');
  assert.deepEqual(listFiles(resources).sort(), [...expected.files.keys()].sort(), 'Inventario resources incorrecto');
  for (const field of ['chatAgents', 'chatSkills']) assert.deepEqual(manifest.contributes?.[field], expected[field], `contributes.${field} incorrecto`);
  assert.deepEqual(manifest.contributes.languageModelTools, toolDefinitions, 'Contribuciones tools incorrectas');
  assert.equal(manifest.contributes.chatAgents.length, 10);
  assert.equal(parseFrontmatter(fs.readFileSync(path.join(root, manifest.contributes.chatAgents[0].path), 'utf8')).metadata.name, 'Pulso');
  assert.deepEqual(listFiles(path.join(resources, 'lib')).sort(), runtimeModules.map(name => `${name}.mjs`).sort());
  for (const [relative, bytes] of expected.files) {
    const actual = fs.readFileSync(path.join(resources, relative));
    assert.ok(actual.equals(bytes), `Recurso desactualizado o alterado: ${relative}`);
    if (relative.endsWith('.json')) JSON.parse(actual);
    if (relative.endsWith('.md')) {
      const text = actual.toString();
      if (relative.endsWith('.agent.md') || relative.endsWith('/SKILL.md')) parseFrontmatter(text);
      assert.ok(!/~\/\.pulso\/(templates|schemas|skills)|\.opencode\//.test(text), `Ruta OpenCode/HOME: ${relative}`);
      for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
        const target = match[1].split('#')[0];
        if (!target || /^(?:[a-z]+:|\/|\{)/i.test(target)) continue;
        const resolved = path.resolve(resources, path.dirname(relative), target);
        // Project/document examples are not bundled references.
        if (/^(?:\.\.\/)*(?:templates|schemas|skills|agents)\//.test(target)) {
          assert.ok(resolved.startsWith(`${resources}${path.sep}`), `Referencia fuera de resources: ${relative}`);
          assert.ok(fs.existsSync(resolved), `Referencia inexistente ${relative}: ${target}`);
        }
      }
    }
  }
  const syntaxFiles = [...listFiles(path.join(root, 'src')).map(file => `src/${file}`), ...listFiles(path.join(root, 'scripts')).map(file => `scripts/${file}`), ...runtimeModules.map(name => `resources/lib/${name}.mjs`)];
  for (const file of syntaxFiles.filter(file => /\.(?:mjs|cjs|js)$/.test(file))) {
    const result = spawnSync(process.execPath, ['--check', path.join(root, file)], {encoding: 'utf8'});
    assert.equal(result.status, 0, `Syntax ${file}: ${result.error?.message || result.stderr}`);
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of text.matchAll(/(?:from\s*|import\s*\()(['"])(\.[^'"]+)\1/g)) {
      assert.ok(fs.existsSync(path.resolve(root, path.dirname(file), match[2])), `Import inexistente ${file}: ${match[2]}`);
    }
  }
  console.log(`Check Pulso: PASS (${expected.files.size} recursos; nombres, rutas, referencias, provenance y sintaxis).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  check().catch(error => { console.error(`Check Pulso: ${error.message}`); process.exitCode = 1; });
}
