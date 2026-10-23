import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function listFiles(root) {
  return fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(entry=>{
    if(entry.isSymbolicLink()) throw new Error(`Symlink resource: ${entry.name}`);
    if(entry.isDirectory()) return listFiles(path.join(root,entry.name)).map(file=>`${entry.name}/${file}`);
    if(!entry.isFile()) throw new Error(`Unsupported resource: ${entry.name}`);
    return [entry.name];
  });
}
export function writeFile(root,relative,bytes) {
  if(path.isAbsolute(relative)||relative.split(/[\\/]/).includes('..')) throw new Error('Unsafe output path');
  const target=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
}
