import fs from 'node:fs';
import {initArtifacts,status} from './artifacts.mjs';
import {atomicWrite,exists,safePath} from './fs.mjs';

function seed(root){
  initArtifacts(root);
  if(!exists(root,'.pulso/project.md'))atomicWrite(root,'.pulso/project.md','# Proyecto\n\nContexto todavía no levantado. Usa la plantilla global proporcionada por Pulso y evidencia del repositorio.\n');
  if(!exists(root,'.pulso/decisions.md'))atomicWrite(root,'.pulso/decisions.md','# Índice de decisiones\n\nSin decisiones registradas. Añadir referencias; no inventar aprobaciones.\n');
}

export function prepareWorkspace(root){
  const folder=safePath(root,'.pulso');
  if(fs.existsSync(folder)&&!fs.statSync(folder).isDirectory())throw new Error(`No es directorio: ${folder}`);
  if(exists(root,'.pulso/state.json')){
    status(root);
    if(!exists(root,'.pulso/history.jsonl')||!fs.existsSync(safePath(root,'.pulso/work'))||!fs.statSync(safePath(root,'.pulso/work')).isDirectory())
      throw new Error(`Workspace Pulso incompleto en ${root}. Conserva sus datos y revisa la instalación; no se reparó automáticamente.`);
    return {prepared:true,target:root,existingWorkspace:true};
  }
  if(fs.existsSync(folder)&&fs.readdirSync(folder).length)throw new Error(`Existe .pulso sin estado actual reconocido en ${root}. Conserva esa carpeta y retira su integración antigua antes de preparar. No se borraron datos.`);
  seed(root);
  return {prepared:true,target:root,existingWorkspace:false};
}
