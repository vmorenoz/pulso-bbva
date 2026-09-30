import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {composeNativeFiles} from '../lib/composition.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=composeNativeFiles({root,runtime:'both',vscodeHarness:'copilot'});
console.log(`Composición válida en memoria: ${files.size} archivos nativos (OpenCode + Copilot). No se escribieron salidas generadas.`);
