import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
export const now = () => new Date().toISOString();
export const idOK = id => typeof id==='string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(id);
export function assertID(id) {if (!idOK(id)) throw new Error('Identificador inválido'); return id;}
/** Paths are relative to a trusted, explicit repository root. No globs or symlink traversal. */
export function safePath(root,relative,{allowDot=false}={}) {
  if (typeof relative!=='string' || !relative || relative.includes('\0') || relative.includes('\\') || /[\x00-\x1f*?]/.test(relative) || path.posix.isAbsolute(relative) || /^[A-Za-z]:/.test(relative)) throw new Error(`Ruta relativa inválida: ${relative}`);
  const parts=relative.split('/');
  if (parts.some(x=>x==='..'||x==='') || (!allowDot && parts.some(x=>x==='.'))) throw new Error(`Ruta no normalizada: ${relative}`);
  const base=path.resolve(root), candidate=path.resolve(base,...parts);
  if (candidate!==base && !candidate.startsWith(base+path.sep)) throw new Error('Ruta fuera del proyecto');
  let current=base;
  if (fs.existsSync(base) && fs.lstatSync(base).isSymbolicLink()) throw new Error('La raíz no puede ser un symlink');
  for (const segment of path.relative(base,candidate).split(path.sep).filter(Boolean)) {
    current=path.join(current,segment);
    try { if(fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink no permitido: ${relative}`); }
    catch(e) {if(e.code!=='ENOENT') throw e;}
  }
  return candidate;
}
export function readText(root,relative) {return fs.readFileSync(safePath(root,relative),'utf8');}
export function readJSON(root,relative) {
  try {return JSON.parse(readText(root,relative));}
  catch(e) {throw new Error(`No se puede leer JSON ${relative}: ${e.message}`,{cause:e});}
}
export function atomicWrite(root,relative,data) {
  const dest=safePath(root,relative);
  fs.mkdirSync(path.dirname(dest),{recursive:true});
  safePath(root,relative); // Check again after directory creation (single writer, not a sandbox).
  const tmp=dest+`.${crypto.randomUUID()}.tmp`;
  let fd;
  try {
    fd=fs.openSync(tmp,'wx',0o600); fs.writeFileSync(fd,data); fs.fsyncSync(fd); fs.closeSync(fd);fd=undefined;
    fs.renameSync(tmp,dest);
    // Directory fsync is best-effort on platforms that do not support it.
    try {const d=fs.openSync(path.dirname(dest),'r');try {fs.fsyncSync(d);} finally {fs.closeSync(d);}} catch {}
  } finally {if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
export const writeJSON=(root,relative,value)=>atomicWrite(root,relative,JSON.stringify(value,null,2)+'\n');
export function exists(root,relative) {return fs.existsSync(safePath(root,relative));}
export function fingerprint(root,relative) {
  const target=safePath(root,relative);
  if (!fs.statSync(target).isFile()) throw new Error(`No es archivo: ${relative}`);
  return {path:relative,sha256:sha256(fs.readFileSync(target))};
}
export function listFiles(directory,prefix='') {
  const out=[];
  for(const item of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    if(item.isSymbolicLink()) throw new Error(`Symlink en distribución: ${item.name}`);
    const relative=prefix?`${prefix}/${item.name}`:item.name;
    if(item.isDirectory())out.push(...listFiles(path.join(directory,item.name),relative));
    else if(item.isFile())out.push(relative);
  }
  return out;
}
