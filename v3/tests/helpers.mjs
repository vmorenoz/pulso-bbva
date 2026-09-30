import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {initArtifacts,createWork,readWork,saveWork} from '../lib/artifacts.mjs';
import {writeJSON,atomicWrite,fingerprint,now} from '../lib/fs.mjs';
export function temp(t){const p=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-v3-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p;}
export function repo(t){const p=temp(t);initArtifacts(p);return p;}
export function create(root,id='DEMO-1'){return createWork(root,{id,title:'Validación sintética',objective:'Validar un resultado',criterion:'El resultado cumple el contrato',verification:'Ejecutar comprobación sintética'});}
export function ready(root,id='DEMO-1'){
  let w=create(root,id);
  atomicWrite(root,'src/value.mjs','export const value = 1;\n');
  atomicWrite(root,`.pulso/work/${id}/evidence/E-1.md`,'# Evidencia sintética de una prueba de artefactos\nNo es una sesión live de orquestación.\n');
  w.tasks=[{id:'T-1',title:'Comprobación sintética',criterionIds:['AC-1'],agent:'pulso-qa-auditor',status:'done',dependsOn:[],writeScope:['src/value.mjs'],resources:[],acceptance:['Validar el contrato sintético'],evidenceIds:['E-1'],summary:'Hecho en fixture.'}];
  w.evidence=[{id:'E-1',kind:'static',status:'pass',checkedAt:now(),criterionIds:['AC-1'],taskIds:['T-1'],report:`.pulso/work/${id}/evidence/E-1.md`,command:null,cwd:'.',exitCode:null,basis:'Fixture determinista; no runtime real',files:[fingerprint(root,'src/value.mjs')],summary:'Revisión sintética para probar integridad de archivos.'}];
  w.objective.criteria[0].evidenceIds=['E-1'];w.status='in_progress';w.summary='Evidencia preparada';w.nextAction='Cerrar después de comprobar la evidencia';
  return saveWork(root,w,1);
}
export {readWork,saveWork,writeJSON,atomicWrite,fingerprint};
