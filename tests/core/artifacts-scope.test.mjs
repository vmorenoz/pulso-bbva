import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {validateDelegation} from '../../core/lib/artifacts.mjs';
import {temp,atomicWrite,writeJSON} from './helpers.mjs';

function fixture(t,{writeScope=['src'],resources=['docs'],inputs=['src','docs/reference.md']}={}){
  const root=temp(t),globalRoot=path.join(root,'installed');
  atomicWrite(root,'src/value.mjs','PRIVATE_SOURCE_CONTENT');
  atomicWrite(root,'docs/reference.md','PRIVATE_DOCUMENT_CONTENT');
  atomicWrite(root,'docs-other/reference.md','PRIVATE_REJECTED_CONTENT');
  fs.mkdirSync(globalRoot);
  writeJSON(globalRoot,'catalog.json',{templates:{plan:'plan.md'},specialists:[{id:'pulso-planner'}]});
  atomicWrite(globalRoot,'plan.md','Fixture template');
  const delegation={schemaVersion:1,id:'D-1',workId:'EXAMPLE-1',workRevision:1,taskIds:['T-1'],agent:'pulso-planner',objective:'Validar scope',inputs,output:'conversation',writeScope,resources,constraints:[],acceptance:['Respetar scope'],questions:[],templateId:'plan'};
  const work={id:delegation.workId,revision:1,tasks:[{id:'T-1',agent:delegation.agent,writeScope,resources,acceptance:delegation.acceptance}]};
  return {root,delegation,work,validate:()=>validateDelegation(root,delegation,{globalRoot,work,canonical:true})};
}

test('Scope permite directorios declarados y descendientes sin ampliar por prefijo',t=>{
  const f=fixture(t);
  assert.deepEqual(f.validate().readScope,['src','docs']);
  f.delegation.inputs=['docs','src/value.mjs'];
  assert.deepEqual(f.validate().resourcePaths,['docs']);
  f.delegation.inputs=['docs-other/reference.md'];
  const before=structuredClone(f.delegation);
  assert.throws(f.validate,error=>{
    assert.match(error.message,/Input no autorizado: "docs-other\/reference.md"/);
    assert.match(error.message,/Scope efectivo autorizado .*\["src","docs"\]/);
    assert.doesNotMatch(error.message,/Recursos descartados|PRIVATE_|installed/);
    assert.match(error.message,/revisar los recursos pertinentes de las tareas/);
    assert.match(error.message,/preparar de nuevo.*conservando los requisitos/);
    assert.match(error.message,/No eliminar inputs necesarios para silenciar el error/);
    return true;
  });
  assert.deepEqual(f.delegation,before);
});

test('Recursos descriptivos, inexistentes e inseguros se diagnostican por índice sin exponer valores',t=>{
  const resources=['docs','Capacidad privada: SECRET_LABEL','missing/reference.md','../SECRET_ESCAPE','/SECRET_HOST'];
  const f=fixture(t,{resources,inputs:['docs-other/reference.md']});
  assert.throws(f.validate,error=>{
    assert.match(error.message,/\["src","docs"\]/);
    assert.match(error.message,/Recursos descartados por no resolver a una ruta segura existente: resources\[1\], resources\[2\], resources\[3\], resources\[4\]/);
    assert.doesNotMatch(error.message,/SECRET_|PRIVATE_|missing\/reference.md/);
    return true;
  });
  f.delegation.inputs=['docs/reference.md'];
  assert.deepEqual(f.validate().resourcePaths,['docs']);
});

test('Recurso inexistente no autoriza input; input inexistente dentro del scope sigue inaccesible',t=>{
  const f=fixture(t,{writeScope:[],resources:['missing/reference.md'],inputs:['missing/reference.md']});
  assert.throws(f.validate,error=>{
    assert.match(error.message,/Input no autorizado: "missing\/reference.md"/);
    assert.match(error.message,/Scope efectivo autorizado .*\[\]/);
    assert.match(error.message,/resources\[0\]/);
    return true;
  });
  f.delegation.writeScope=f.work.tasks[0].writeScope=['missing'];
  assert.throws(f.validate,/Input inaccesible: missing\/reference.md/);
});

test('Corregir recursos de tarea permite preparar el mismo input sin quitar requisitos',t=>{
  const f=fixture(t,{inputs:['docs-other/reference.md']});
  assert.throws(f.validate,/Input no autorizado/);
  f.delegation.resources=[...f.delegation.resources,'docs-other'];
  assert.throws(f.validate,/Encargo no canónico: resources/);
  f.work.tasks[0].resources=[...f.delegation.resources];
  assert.deepEqual(f.validate().readScope,['src','docs','docs-other']);
  assert.deepEqual(f.delegation.inputs,['docs-other/reference.md']);
  assert.deepEqual(f.delegation.acceptance,['Respetar scope']);
});

test('Symlinks descartados no autorizan lecturas y rutas de input inseguras siguen rechazadas',t=>{
  const f=fixture(t,{resources:['linked'],inputs:['docs-other/reference.md']});
  fs.symlinkSync(path.join(f.root,'docs'),path.join(f.root,'linked'));
  assert.throws(f.validate,error=>{
    assert.match(error.message,/Input no autorizado/);
    assert.match(error.message,/Scope efectivo autorizado .*\["src"\]/);
    assert.match(error.message,/resources\[0\]/);
    assert.doesNotMatch(error.message,/linked|PRIVATE_/);
    return true;
  });
  for(const [input,expected] of [['linked/reference.md',/Symlink no permitido/],['../escape',/patrón inválido|Ruta no normalizada/],['/absolute',/patrón inválido|Ruta relativa inválida/]]){
    f.delegation.inputs=[input];
    assert.throws(f.validate,expected);
  }
});
