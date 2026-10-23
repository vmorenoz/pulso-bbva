import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const help=`Pulso — configurar el plugin desde el paquete preparado por los desarrolladores
Uso (desde la raíz): node install.mjs [opciones]
  --dry-run                   Mostrar el plan sin instalar
  --yes                       Confirmar el plan sin pregunta interactiva
  --conflict backup-replace   Autorizar las sustituciones permitidas con backup
  --help                      Mostrar esta ayuda sin necesitar el paquete
Sin --yes se conserva la confirmación interactiva. El conflicto por defecto es abort.
Las opciones se pasan al instalador del bundle; --yes no permite colisiones ajenas.
Requiere Node.js >=22 y tar estándar de macOS/Linux.
Usa artifacts/pulso-opencode-installer-<versión de package.json>.tar.gz
y su .sha256. No instala dependencias, compila ni descarga archivos.`;

function tar(args){
  const env={...process.env,COPYFILE_DISABLE:'1',LC_ALL:'C'};
  delete env.TAR_OPTIONS;
  const result=spawnSync('tar',args,{encoding:'utf8',env,maxBuffer:16*1024*1024});
  if(result.error)throw new Error(`No se pudo ejecutar tar: ${result.error.message}`);
  if(result.status!==0)throw new Error(`Archivo de instalación inválido o extracción fallida: ${result.stderr.trim() || result.signal || result.status}`);
  return result.stdout;
}

// Only regular files and directories within the single release folder are allowed.
// Reject links before extraction: a safe-looking member name alone is insufficient.
function validateArchive(archive,name){
  const entries=tar(['-tzf',archive]).trimEnd().split('\n');
  const types=tar(['-tvzf',archive]).trimEnd().split('\n');
  if(!entries.length||types.length!==entries.length||types.some(line=>!/^[-d]/.test(line)))throw new Error('Archivo inseguro: solo se permiten archivos regulares y directorios, sin enlaces.');
  for(const entry of entries){
    const parts=entry.replace(/\/$/,'').split('/');
    if(parts[0]!==name||parts.some(p=>!p||p==='.'||p==='..')||/[\\\x00-\x1f\x7f]/.test(entry))throw new Error(`Ruta insegura en el archivo: ${JSON.stringify(entry)}`);
  }
  if(!entries.includes(`${name}/install.mjs`))throw new Error('Archivo incompleto: falta install.mjs del bundle.');
}

export function bootstrap(args=process.argv.slice(2)){
  if(args.includes('--help')){console.log(help);return 0;}
  if(Number(process.versions.node.split('.')[0])<22)throw new Error('Pulso requiere Node.js 22 o posterior.');
  const {version}=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  if(typeof version!=='string'||!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version))throw new Error('Versión inválida en package.json.');
  const name=`pulso-opencode-installer-${version}`,filename=`${name}.tar.gz`;
  const source=path.join(root,'artifacts',filename);
  for(const file of [source,`${source}.sha256`])if(!fs.existsSync(file))throw new Error(`Falta el paquete preparado o su checksum: ${file}. Solicita a los desarrolladores el paquete ${version} y su .sha256; no se compila ni descarga automáticamente.`);
  const checksum=fs.readFileSync(`${source}.sha256`,'utf8').trim();
  const match=/^([a-fA-F0-9]{64})[ \t]+\*?([^\r\n]+)$/.exec(checksum);
  if(!match||match[2]!==filename)throw new Error(`Checksum SHA-256 inválido: ${source}.sha256`);
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'pulso-bootstrap-'));
  try{
    // Verify the private copy that tar will read, rather than a mutable checkout file.
    const archive=path.join(temporary,'bundle.tar.gz');
    fs.copyFileSync(source,archive);
    const digest=createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    if(digest!==match[1].toLowerCase())throw new Error(`SHA-256 no coincide: ${source}. Solicita de nuevo el paquete y su checksum.`);
    validateArchive(archive,name);
    tar(['-xzf',archive,'-C',temporary,'--no-same-owner','--no-same-permissions']);
    const entry=path.join(temporary,name,'install.mjs');
    if(!fs.lstatSync(entry).isFile())throw new Error('Archivo incompleto: install.mjs no es un archivo regular.');
    const result=spawnSync(process.execPath,[entry,...args],{stdio:'inherit'});
    if(result.error)throw new Error(`No se pudo ejecutar el instalador: ${result.error.message}`);
    return result.status ?? (128+(os.constants.signals[result.signal]||1));
  }finally{
    fs.rmSync(temporary,{recursive:true,force:true});
  }
}

export function main(){
  try{process.exitCode=bootstrap();}
  catch(error){console.error(`Pulso: ${error.message}`);process.exitCode=1;}
}
