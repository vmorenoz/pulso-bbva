import fs from 'node:fs';

export const template = name => JSON.parse(fs.readFileSync(new URL(`../../core/templates/${name}.json`, import.meta.url), 'utf8'));

// The authored result template is a compact specialist return. The persisted v1
// result remains supported, but must not be synthesized by spreading that template.
export function legacyResult(overrides = {}) {
  return {schemaVersion:1,delegationId:'D-1',workId:'EXAMPLE-1',workRevision:1,
    agent:'pulso-planner',status:'blocked',summary:'Awaiting an explicit decision',
    artifacts:[],changedFiles:[],checks:[],findings:[],questions:[],
    limitations:['Synthetic contract fixture; no native execution'],suggestedNextStep:null,
    ...overrides};
}

// One independent positive matrix for persisted mutations and advertised tools.
// Keep these explicit: deriving test inputs from production schemas can hide drift.
export const mutationCases = [
  {type:'work.set_overview',priority:'critical'},
  {type:'task.add',task:template('task')},
  {type:'task.update',taskId:'T-1',patch:{title:'Título'}},
  {type:'task.set_status',taskId:'T-1',status:'pending'},
  {type:'task.remove',taskId:'T-1'},
  {type:'criterion.add',criterion:{id:'AC-2',description:'Criterio',verification:'Comprobar'}},
  {type:'criterion.update',criterionId:'AC-1',description:'Actualizado',reason:'Acordado'},
  {type:'criterion.remove',criterionId:'AC-2'},
  {type:'document.register',document:{kind:'evidence',path:'report.md',templateVersion:'evidence@1.0'}},
  {type:'document.unregister',path:'report.md'},
  {type:'evidence.add',evidence:template('evidence')},
  {type:'evidence.update',evidenceId:'E-1',patch:{summary:'Corrección'}},
  {type:'evidence.remove',evidenceId:'E-1'}
];
export const objectVariants = shape => shape.anyOf ? shape.anyOf.flatMap(objectVariants) : [shape];
