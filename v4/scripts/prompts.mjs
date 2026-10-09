import fs from 'node:fs';
import path from 'node:path';

const resourceTokens = {
  RESOURCE_CATALOG: ['catálogo', 'agents/catalog.json'],
  RESOURCE_DELEGATION_SCHEMA: ['schema de delegación', 'schemas/delegation.schema.json'],
  RESOURCE_RESULT_SCHEMA: ['schema de resultado', 'schemas/result.schema.json'],
  RESOURCE_TEMPLATES: ['plantillas', 'templates'],
};

/** Authored slots only. Never translate prose, product names, or skill contents. */
export function renderPrompt(text, {boundary, resourceBase = 'resources', destination} = {}) {
  if (typeof boundary !== 'string' || !boundary.trim()) throw new Error('Missing adapter boundary');
  if (typeof destination !== 'string' || path.posix.isAbsolute(destination) || destination.split('/').includes('..')) throw new Error('Invalid prompt destination');
  const slots = {ADAPTER_BOUNDARY: boundary};
  for (const [token, [label, target]] of Object.entries(resourceTokens)) {
    const relative = path.posix.relative(path.posix.dirname(destination), path.posix.join(resourceBase, target));
    slots[token] = `[${label}](${relative})`;
  }
  const output = text.replace(/\{\{([^{}]+)\}\}/g, (_, name) => {
    if (!Object.hasOwn(slots, name)) throw new Error(`Unknown authored prompt slot: ${name}`);
    return slots[name];
  });
  if (/\{\{/.test(output)) throw new Error('Unexpanded or malformed prompt slot');
  return output;
}

export function readAgentBody(coreRoot, id) {
  if (!/^pulso(?:-[a-z-]+)?$/.test(id)) throw new Error('Invalid agent id');
  const read = relative => fs.readFileSync(path.join(coreRoot, 'agents', relative), 'utf8').trim();
  return id === 'pulso' ? read('pulso.md') : `${read('common.md')}\n\n${read(`${id}.md`)}`;
}

export function renderSkill(text, options) { return renderPrompt(text, options); }
