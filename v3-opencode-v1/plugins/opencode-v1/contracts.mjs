/** Public native-tool contracts. Core schemas independently validate persisted data. */
export function contracts(z){
  const text=(max=4000)=>z.string().trim().min(1).max(max), id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/), ids=z.array(id).max(50), strings=z.array(text()).max(50);
  const object=shape=>z.object(shape).strict(), optional=s=>s.optional(), revision=z.number().int().positive(), priority=z.enum(['low','normal','high','critical']);
  const agent=z.enum(['pulso-researcher','pulso-explorer','pulso-planner','pulso-plan-auditor','pulso-executor','pulso-qa-auditor','pulso-security-auditor','pulso-code-reviewer','pulso-ui-auditor']);
  const templateId=z.enum(['project','research','exploration','plan','review','implementation','evidence','ui-review','spec','delivery','decision']);
  const status=z.enum(['pending','in_progress','blocked','paused','done','cancelled']), resultStatus=z.enum(['pass','fail','blocked','not_run']);
  const relative=text(1000).regex(/^(?!\/)(?![A-Za-z]:)(?!.*[\\\x00-\x1f*?])(?!.*(?:^|\/)\.\.?(?:\/|$))(?!.*\/\/)(?!.*\/$).+$/,'Ruta relativa normalizada requerida');
  const paths=z.array(relative).max(50);
  const taskFields={id,title:text(300),criterionIds:ids.min(1),agent:agent.nullable(),status,dependsOn:ids,writeScope:paths,resources:z.array(text(1000)).max(50),acceptance:z.array(text(1000)).min(1).max(50),evidenceIds:ids,summary:z.string().max(2000)};
  const hash=z.string().regex(/^[a-f0-9]{64}$/), basisItem=object({id,sha256:hash});
  const evidence=object({id,kind:z.enum(['executed','manual','static','not_run']),status:resultStatus,checkedAt:z.string().datetime({offset:true}),criterionIds:ids,taskIds:ids,report:relative,command:text().nullable(),cwd:z.union([z.literal('.'),relative]),exitCode:z.number().int().nullable(),basis:text(),files:z.array(z.union([object({path:relative,sha256:hash}),object({path:relative,absent:z.literal(true)})])).min(1).max(50),summary:text(2000),acceptanceBasis:object({criteria:z.array(basisItem).max(50),tasks:z.array(basisItem).max(50)})});
  const action=(type,fields)=>{
    const shape=object({type:z.literal(type),...fields});
    if(type==='work.set_overview')return shape.refine(value=>Object.keys(value).some(key=>key!=='type'),'Incluye al menos un campo de overview');
    if(type==='task.update')return shape.refine(value=>Object.keys(value.patch).length>0,'patch no puede estar vacío');
    if(type==='criterion.update')return shape.refine(value=>value.description!==undefined||value.verification!==undefined,'Incluye descripción o verificación');
    return shape;
  };
  const mutation=z.discriminatedUnion('type',[
    action('work.set_overview',{summary:optional(text(2000)),blockers:optional(z.array(text(500)).max(30)),decisionsPending:optional(z.array(text(500)).max(30)),nextAction:optional(text(1000).nullable()),priority:optional(priority),status:optional(z.enum(['pending','in_progress','blocked','paused']))}),
    action('task.add',{task:object(taskFields)}),
    action('task.update',{taskId:id,reason:optional(text(1000)),decisionRef:optional(text(1000)),patch:object(Object.fromEntries(['title','criterionIds','agent','dependsOn','writeScope','resources','acceptance','summary'].map(k=>[k,optional(taskFields[k])])))}),
    action('task.set_status',{taskId:id,status,summary:optional(text(2000))}),action('task.remove',{taskId:id}),
    action('criterion.add',{criterion:object({id,description:text(),verification:text()})}),
    action('criterion.update',{criterionId:id,reason:text(1000),decisionRef:optional(text(1000)),description:optional(text()),verification:optional(text())}),action('criterion.remove',{criterionId:id}),
    action('document.register',{document:object({kind:text(80),path:relative,templateVersion:text(80)})}),action('document.unregister',{path:relative}),
    action('evidence.add',{evidence}),action('evidence.update',{evidenceId:id,patch:object({summary:text(2000),editedAt:optional(z.string().datetime({offset:true}))})}),action('evidence.remove',{evidenceId:id})
  ]);
  const delegation=object({schemaVersion:z.literal(1),id,workId:id,workRevision:revision,taskIds:ids.min(1),agent,objective:text(),inputs:paths,templateId,output:relative,writeScope:paths,resources:strings,constraints:strings,acceptance:strings.min(1),questions:strings});
  const result=object({schemaVersion:z.literal(1),delegationId:id,workId:id,workRevision:revision,agent,status:z.enum(['completed','blocked','failed','cancelled']),summary:text(),artifacts:paths,changedFiles:paths,checks:z.array(object({description:text(),status:resultStatus,evidenceRef:relative.nullable()})).max(100),findings:z.array(object({id,severity:z.enum(['critical','high','medium','low','info']),description:text(),reference:text(),recommendation:text()})).max(100),questions:strings,limitations:strings,suggestedNextStep:text().nullable()});
  const query={limit:optional(z.number().int().min(1).max(100)),cursor:optional(text(4000))}, workRef={workId:id,expectedRevision:revision};
  const request=(action,fields={})=>object({action:z.literal(action),...fields});
  const workspace=z.discriminatedUnion('action',[
    request('prepare'),request('status',{...query,status:optional(z.enum(['pending','in_progress','blocked','paused']))}),request('validate',{fresh:optional(z.boolean())}),request('sync',workRef),request('recover'),request('attempts',{workId:optional(id),sessionID:optional(text(160)),limit:query.limit}),request('reconcile_attempts',{workId:optional(id),sessionID:optional(text(160)),limit:query.limit})
  ]);
  const work=z.discriminatedUnion('action',[
    request('get',{workId:id,section:optional(z.enum(['all','overview','criteria','tasks','documents','evidence','acceptanceChanges'])),...query}),
    request('create',{workId:optional(id),title:text(240),objective:text(),criterion:text(),verification:text(),priority:optional(priority)}),
    request('update',{...workRef,actions:z.array(mutation).min(1).max(20)}),request('block',{...workRef,summary:text(2000),reason:text(500)}),request('close',{...workRef,outcome:optional(z.enum(['done','cancelled'])),summary:text(),limitations:optional(z.array(text(1000)).max(30))}),request('reopen',{...workRef,reason:text(2000)}),request('validate_result',{delegation,result})
  ]);
  const scope=z.enum(['project','user']), source=z.enum(['user','observed','delegated']), memoryRef={scope,expectedRevision:revision};
  const context=z.discriminatedUnion('action',[
    request('summary'),request('read',{scope:optional(z.enum(['project','user','all'])),section:optional(z.enum(['context','preferences','learning','all'])),key:optional(text(120)),...query}),
    request('set_context',{...memoryRef,context:z.string().max(4000)}),request('set_preference',{...memoryRef,key:text(120),value:text(1000),source}),request('remove_preference',{...memoryRef,key:text(120)}),request('add_learning',{...memoryRef,note:text(2000),source})
  ]);
  const history=object({workId:optional(id),since:optional(z.string().datetime({offset:true})),until:optional(z.string().datetime({offset:true})),...query});
  return {workspace,work,context,history,mutation};
}
