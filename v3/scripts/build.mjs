import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {composeNativeFiles} from '../lib/composition.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=composeNativeFiles({root});
console.log(`Composición válida en memoria: ${files.size} archivos OpenCode v2 (agentes, comandos, skills y plugin). No se escribieron salidas generadas.`);
