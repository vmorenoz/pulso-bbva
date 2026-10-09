/** Validator for the deliberately small vocabulary used by Pulso's bundled schemas.
 * Not a general JSON Schema implementation. Unknown validation keywords fail closed.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../schemas');
const supported = new Set(['$schema','$id','title','description','type','properties','required',
  'additionalProperties','items','minItems','maxItems','minLength','maxLength','pattern','format',
  'minimum','maximum','enum','const','anyOf']);
const cache = new Map();
export function schema(name) {
  if (!/^[a-z-]+$/.test(name)) throw new Error('Nombre de esquema inválido');
  if (!cache.has(name)) cache.set(name, JSON.parse(readFileSync(path.join(directory, `${name}.schema.json`), 'utf8')));
  return cache.get(name);
}
export function checkSchemaVocabulary(s, at = '$') {
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error(`Esquema no soportado: ${at}`);
  for (const k of Object.keys(s)) if (!supported.has(k)) throw new Error(`Keyword de schema no soportada: ${at}.${k}`);
  for (const [k,v] of Object.entries(s.properties || {})) checkSchemaVocabulary(v, `${at}.${k}`);
  if (s.items) checkSchemaVocabulary(s.items, `${at}[]`);
  if (s.anyOf) s.anyOf.forEach(x => checkSchemaVocabulary(x, at));
  if (s.additionalProperties !== undefined && typeof s.additionalProperties !== 'boolean') throw new Error('additionalProperties debe ser boolean');
  if (s.format && s.format !== 'date-time') throw new Error(`Formato no soportado: ${s.format}`);
}
function datetime(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v)) return false;
  const [,y,m,d,h,mi,se] = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(v);
  if (+m < 1 || +m > 12 || +d < 1 || +d > new Date(Date.UTC(+y,+m,0)).getUTCDate() || +h > 23 || +mi > 59 || +se > 59) return false;
  return Number.isFinite(Date.parse(v));
}
function walk(s,v,p,e) {
  if (s.anyOf) {
    const alternatives=s.anyOf.map(sub=>{const errors=[];walk(sub,v,p,errors);return {sub,errors};});
    if(alternatives.some(item=>!item.errors.length))return;
    // Prefer the matching discriminator (e.g. action.type), then the closest
    // branch. Surface a useful field error instead of dumping every variant.
    const matching=alternatives.filter(({sub})=>v&&typeof v==='object'&&Object.entries(sub.properties||{}).some(([key,shape])=>Object.hasOwn(shape,'const')&&v[key]===shape.const));
    const best=(matching.length?matching:alternatives).sort((a,b)=>a.errors.length-b.errors.length)[0];
    e.push(...best.errors);
    return;
  }
  if (Object.hasOwn(s,'const') && JSON.stringify(v)!==JSON.stringify(s.const)) e.push(`${p}: debe ser ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.some(x=>JSON.stringify(x)===JSON.stringify(v))) e.push(`${p}: valor fuera del enum`);
  const actual = v===null?'null':Array.isArray(v)?'array':typeof v;
  if (s.type) {
    const valid = s.type==='integer' ? typeof v==='number'&&Number.isSafeInteger(v) : actual===s.type;
    if (!valid) {e.push(`${p}: tipo esperado ${s.type}, recibido ${actual}`); return;}
  }
  if (typeof v==='string') {
    const n=[...v].length;
    if (s.minLength!==undefined && n<s.minLength) e.push(`${p}: texto demasiado corto`);
    if (s.maxLength!==undefined && n>s.maxLength) e.push(`${p}: texto demasiado largo`);
    if (s.pattern && !new RegExp(s.pattern).test(v)) e.push(`${p}: patrón inválido`);
    if (s.format==='date-time' && !datetime(v)) e.push(`${p}: fecha ISO 8601 inválida`);
  }
  if (typeof v==='number') {
    if (!Number.isFinite(v)) e.push(`${p}: número no finito`);
    if (s.minimum!==undefined && v<s.minimum) e.push(`${p}: menor que ${s.minimum}`);
    if (s.maximum!==undefined && v>s.maximum) e.push(`${p}: mayor que ${s.maximum}`);
  }
  if (Array.isArray(v)) {
    if (s.minItems!==undefined && v.length<s.minItems) e.push(`${p}: faltan elementos`);
    if (s.maxItems!==undefined && v.length>s.maxItems) e.push(`${p}: demasiados elementos`);
    if (s.items) v.forEach((x,i)=>walk(s.items,x,`${p}[${i}]`,e));
  } else if (v && typeof v==='object') {
    for (const k of s.required||[]) if (!Object.hasOwn(v,k)) e.push(`${p}.${k}: requerido`);
    for (const [k,val] of Object.entries(v)) {
      if (Object.hasOwn(s.properties||{},k)) walk(s.properties[k],val,`${p}.${k}`,e);
      else if (s.additionalProperties===false) e.push(`${p}.${k}: campo desconocido`);
    }
  }
}
export function validateSchema(s,value) {checkSchemaVocabulary(s);const errors=[];walk(s,value,'$',errors);return errors;}
export function schemaError(label,errors){
  const issues=errors.slice(0,8).map(message=>({code:'SCHEMA_INVALID',entity:message.split(':')[0],message:message.slice(0,240)}));
  const error=new Error(`${label}: ${issues[0]?.message||'valor inválido'}${errors.length>1?`; ${errors.length-1} errores adicionales (consultar issues)`:''}`.slice(0,500));
  error.code='SCHEMA_INVALID';error.issues=issues;error.issueCount=errors.length;return error;
}
export function assertSchema(name,value) {
  const errors=validateSchema(schema(name),value);
  if (errors.length) throw schemaError(name,errors);
  return value;
}
