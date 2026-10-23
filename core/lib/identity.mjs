import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import {exists,readJSON,writeJSON,safePath,withWorkspaceLock} from './fs.mjs';

export const isUUID=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const generateWorkId=()=>`PULSO-${randomUUID()}`;

function localIdentity(root){
  const localPath='.pulso/project.json';
  const hasLocal=exists(root,localPath),local=hasLocal?readJSON(root,localPath):null;
  if(hasLocal&&(!local||!isUUID(local.projectId)||local.schemaVersion!==1))throw new Error('Identidad local inválida; no se sobrescribirá');
  return local;
}
function registeredIdentity(homeDir,projectId){
  const registryPath=`.pulso/projects/${projectId}.json`;
  const hasRegistered=exists(homeDir,registryPath),registered=hasRegistered?readJSON(homeDir,registryPath):null;
  if(hasRegistered&&(!registered||registered.schemaVersion!==1||registered.projectId!==projectId||!Array.isArray(registered.locations)||registered.locations.some(p=>typeof p!=='string'||!path.isAbsolute(p))))
    throw new Error('Registro de proyecto inválido; no se sobrescribirá');
  return registered;
}
/** Lock order: workspace -> per-project global registry. No inverse acquisition.
 * The plan is read-only; publication must reread both authorities under their locks.
 */
export function publishProjectIdentity(root,projectId,{homeDir=os.homedir()}={}){
  if(!isUUID(projectId))throw new Error('Identidad de proyecto inválida');
  return withWorkspaceLock(root,()=>{
    const relative=`.pulso/locks/projects/${projectId}`,directory=safePath(homeDir,relative);
    fs.mkdirSync(directory,{recursive:true});safePath(homeDir,relative);
    return withWorkspaceLock(directory,()=>{
      const local=localIdentity(root);
      if(local&&local.projectId!==projectId)throw new Error('Identidad local cambió; releer antes de publicar');
      const registered=registeredIdentity(homeDir,projectId);
      const record={...registered,schemaVersion:1,projectId,locations:[...new Set([...(registered?.locations??[]),path.resolve(root)])]};
      if(!local)writeJSON(root,'.pulso/project.json',{schemaVersion:1,projectId});
      if(!registered||JSON.stringify(registered)!==JSON.stringify(record))writeJSON(homeDir,`.pulso/projects/${projectId}.json`,record);
      return {projectId,locations:record.locations};
    });
  });
}
// Preflight both files before creating anything. A valid local identity is authoritative.
export function planProjectIdentity(root,options={}) {
  const projectId=localIdentity(root)?.projectId??randomUUID();
  registeredIdentity(options.homeDir??os.homedir(),projectId);
  return {projectId,commit:()=>publishProjectIdentity(root,projectId,options)};
}
export function ensureProjectIdentity(root,options={}) {return planProjectIdentity(root,options).commit();}
