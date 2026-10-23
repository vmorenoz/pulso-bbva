/** Native OpenCode 2.1.2 Promise-domain double. Never evidence of a live host. */
export function primaryReader(directory,{agent='pulso'}={}) {
  return {
    async getSession(sessionID) {return {id:sessionID,projectID:'native-project',location:{directory},agent};},
    async getMessage(sessionID,messageID) {return {id:messageID,type:'assistant',agent,content:[]};},
    async history() {return [];},
    async status() {return {};},
  };
}
export function createHost({directory,reader=primaryReader(directory),permission}={}) {
  const tools={},hooks={},requests=[],subscribers=new Set();
  const host={app:{name:'opencode',version:'2.1.2',channel:'stable'},location:{directory,project:{id:'native-project',directory,canonical:directory}},options:{},
    permission:{async assert(input) {requests.push(input);if(permission)await permission(input);}},
    tool:{async transform(fn) {fn({add(tool){tools[tool.name]=tool;}});return {dispose(){}};},async hook(name,fn) {hooks[name]=fn;return {dispose(){}};}},
    session:{get:({sessionID})=>reader.getSession(sessionID),async hook(name,fn) {hooks[name]=fn;return {dispose(){}};}},
    event:{async *subscribe({signal}={}) {const sub={queue:[],wake:null};subscribers.add(sub);try{while(!signal?.aborted) {if(sub.queue.length) {yield sub.queue.shift();continue;}await new Promise(resolve=>{sub.wake=resolve;signal?.addEventListener('abort',resolve,{once:true});});sub.wake=null;}}finally{subscribers.delete(sub);}}},
  };
  return {host,tools,hooks,requests,emit(event){for(const sub of subscribers){sub.queue.push(event);sub.wake?.();}},reader};
}
export async function setupPlugin(module,{directory,homeDir,reader=primaryReader(directory),permission}={}) {
  const fixture=createHost({directory,reader,permission});
  const definition=module.createPulsoPlugin ? module.createPulsoPlugin({reader,homeDir}) : module;
  fixture.dispose=await definition.setup(fixture.host);
  fixture.context={sessionID:'ses_primary',messageID:'msg_primary',agent:'pulso',id:'call_primary',signal:new AbortController().signal};
  fixture.invoke=async(name,input,context=fixture.context)=>(await fixture.tools[name].execute(name==='pulso_history'?input:{request:input},context)).output;
  return fixture;
}
