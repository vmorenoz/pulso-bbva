/** OpenCode 2.1.2 native session/message proof. Model arguments never confer authority. */
import fs from 'node:fs';
import {correlation} from './delegation-observer.mjs';
import {readDelegation} from '../resources/lib/delegation-registry.mjs';
import {contentHash} from '../resources/lib/continuity.mjs';
import {scopeError} from '../resources/lib/assignment-tools.mjs';
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export function sameRoot(directory, root) {try {return typeof directory === 'string' && fs.realpathSync(directory) === root;} catch {return false;}}
export async function nativeAuthority(reader, context, root) {
  if (!['sessionID','messageID','agent','id'].every(key => nonempty(context?.[key]))) throw scopeError('Identidad nativa de sesión/mensaje/agente/llamada no disponible','NATIVE_AUTHORITY_UNAVAILABLE');
  let session, message;
  try {session = await reader.getSession(context.sessionID); message = await reader.getMessage(context.sessionID, context.messageID);}
  catch {throw scopeError('No se pudo comprobar la identidad nativa','NATIVE_AUTHORITY_UNAVAILABLE');}
  if (session?.id !== context.sessionID || !nonempty(session.projectID) || !sameRoot(session.location?.directory, root)) throw scopeError('Sesión nativa de otro proyecto');
  if (message?.id !== context.messageID || message.type !== 'assistant' || message.agent !== context.agent) throw scopeError('Agente/mensaje nativo no coincide con la invocación');
  if (!session.parentID) {
    if (context.agent !== 'pulso') throw scopeError('Sólo el primario Pulso coordina las tools globales');
    return Object.freeze({kind:'primary',projectRoot:root,sessionID:session.id,agent:context.agent});
  }
  const parent = await reader.getSession(session.parentID);
  if (parent?.id !== session.parentID || parent.parentID || parent.projectID !== session.projectID || !sameRoot(parent.location?.directory, root)) throw scopeError('Ancestría nativa ajena o recursiva');
  // The native paginated full transcript, not compacted model context. The reader
  // rejects truncated/ambiguous histories instead of authenticating a partial view.
  const messages = await reader.history(parent.id,{includeLive:true});
  const matches = messages.flatMap(message => message.type === 'assistant' && Array.isArray(message.content) ? message.content.filter(part => part.type === 'tool' && part.name === 'subagent' && part.state?.metadata?.sessionID === session.id).map(part => ({part,message})) : []);
  if (matches.length !== 1) throw scopeError('No hay una única llamada padre verificable para este hijo');
  const {part,message:owner} = matches[0], state = part.state;
  // `executed` means providerExecuted, not local execution success (V2 runner).
  if (owner.agent !== 'pulso' || part.executed === true || !nonempty(part.id)) throw scopeError('Llamada padre con rol o ejecución incoherente');
  // A completed subagent *tool* can have merely launched a running background child.
  if (!['running','completed'].includes(state.status) || state.metadata?.status !== 'running') throw scopeError('La llamada nativa padre no está activa');
  const ids = correlation(state.input?.prompt);
  if (ids.correlationConflicts?.length || !ids.workId || !ids.delegationId) throw scopeError('Llamada padre sin identidad canónica inequívoca');
  const record = readDelegation(root,{workId:ids.workId,delegationId:ids.delegationId});
  if (state.input?.agent !== context.agent || record.delegation.agent !== context.agent || state.input.prompt !== record.specialistPrompt || !record.attempts.some(attempt => attempt.sessionID === parent.id && attempt.callID === part.id && attempt.agent === context.agent && attempt.provenance === 'host_dispatch')) throw scopeError('Llamada/rol/prompt no coincide con el dispatch persistido');
  return Object.freeze({kind:'assignment',projectRoot:root,sessionID:session.id,parentSessionID:parent.id,parentCallID:part.id,workId:record.workId,delegationId:record.delegationId,continuityId:record.continuityId,agent:context.agent,promptHash:contentHash(record.specialistPrompt)});
}
