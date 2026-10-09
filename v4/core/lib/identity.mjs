import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {exists,readJSON,writeJSON} from './fs.mjs';

export const isUUID=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const generateWorkId=()=>`PULSO-${randomUUID()}`;

// Preflight both files before creating anything. A valid local identity is authoritative.
export function planProjectIdentity(root,{homeDir=os.homedir()}={}) {
  const location=path.resolve(root),localPath='.pulso/project.json';
  const hasLocal=exists(root,localPath),local=hasLocal?readJSON(root,localPath):null;
  if(hasLocal&&(!local||!isUUID(local.projectId)||local.schemaVersion!==1))throw new Error('Identidad local inválida; no se sobrescribirá');
  const projectId=local?.projectId??randomUUID(),registryPath=`.pulso/projects/${projectId}.json`;
  const hasRegistered=exists(homeDir,registryPath),registered=hasRegistered?readJSON(homeDir,registryPath):null;
  if(hasRegistered&&(!registered||registered.schemaVersion!==1||registered.projectId!==projectId||!Array.isArray(registered.locations)||registered.locations.some(p=>typeof p!=='string'||!path.isAbsolute(p))))
    throw new Error('Registro de proyecto inválido; no se sobrescribirá');
  const record={...registered,schemaVersion:1,projectId,locations:[...new Set([...(registered?.locations??[]),location])]};
  return {projectId,commit(){
    // Persist authority first: a failed registry write can be retried with the same UUID.
    if(!local)writeJSON(root,localPath,{schemaVersion:1,projectId});
    if(!registered||JSON.stringify(registered)!==JSON.stringify(record))writeJSON(homeDir,registryPath,record);
    return {projectId,locations:record.locations};
  }};
}
export function ensureProjectIdentity(root,options={}) {return planProjectIdentity(root,options).commit();}
