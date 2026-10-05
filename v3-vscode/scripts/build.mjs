import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {composeResources, pulsoToolNames} from '../src/composition.mjs';

export const extensionRoot = fileURLToPath(new URL('../', import.meta.url));

export async function build({root = extensionRoot, sourceRoot} = {}) {
  // Resolve both integration inputs before writing anything.
  const manifestPath = path.join(root, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const {toolDefinitions} = await import(pathToFileURL(path.join(root, 'src/tools.mjs')).href);
  if (!Array.isArray(toolDefinitions) || toolDefinitions.length !== 4) throw new Error('src/tools.mjs debe exportar cuatro toolDefinitions');
  if (pulsoToolNames.some(name => !toolDefinitions.some(tool => tool.name === name))) throw new Error('toolDefinitions debe declarar las cuatro tools Pulso del contrato');
  const toolNames = toolDefinitions.map(tool => tool.toolReferenceName || tool.name);
  if (toolNames.some(name => typeof name !== 'string' || !name) || new Set(toolNames).size !== 4) throw new Error('Referencias de tools inválidas');
  const composed = composeResources({root: sourceRoot, toolNames});
  const resources = path.join(root, 'resources');
  // Resources is build-owned; replace stale outputs and directories, including prompts.
  fs.rmSync(resources, {recursive: true, force: true});
  fs.mkdirSync(resources, {recursive: true});
  for (const [relative, bytes] of composed.files) {
    const destination = path.join(resources, relative);
    fs.mkdirSync(path.dirname(destination), {recursive: true});
    fs.writeFileSync(destination, bytes);
  }
  manifest.contributes ??= {};
  Object.assign(manifest.contributes, {chatAgents: composed.chatAgents, chatSkills: composed.chatSkills, languageModelTools: toolDefinitions});
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Pulso: ${composed.files.size} recursos, ${composed.chatAgents.length} agentes, ${composed.chatSkills.length} skills.`);
  return composed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().catch(error => { console.error(`Build Pulso: ${error.message}`); process.exitCode = 1; });
}
