/** Managed v2 adapter contract. Native host dispatch-blocking remains a host acceptance check. */
import fs from 'node:fs';
import path from 'node:path';
import {readDelegation, recordNativeDispatch, recordNativeReturn} from '../resources/lib/delegation-registry.mjs';
import {correlation} from './delegation-observer.mjs';

// Diagnostics contain positions only, never prompt excerpts or differing characters.
function promptDifference(expected, received) {
  let offset = 0, line = 1, column = 1;
  while (offset < expected.length && offset < received.length && expected[offset] === received[offset]) {
    if (expected[offset] === '\n') { line++; column = 1; } else column++;
    offset++;
  }
  return `prompt(firstDifference: UTF-16 offset=${offset}, line=${line}, column=${column}, expectedLength=${expected.length}, receivedLength=${received.length})`;
}

function roleLabel(role) {
  // Only role-shaped identifiers are printable; arbitrary payloads are redacted.
  if (typeof role === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(role)) return JSON.stringify(role);
  return role === undefined ? '<missing>' : '<redacted invalid role>';
}

export function nativeContext(context) {
  return Object.fromEntries([['sessionID',context?.sessionID],['messageID',context?.messageID],['callID',context?.id]].filter(([,value]) => typeof value === 'string' && value.trim()));
}
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const textContent = value => typeof value === 'string' ? value : Array.isArray(value) && value.length === 1 && value[0]?.type === 'text' ? value[0].text : null;
const pending = (ids,reason) => ({...ids,capture:'pending',reason,acceptance:'not_assessed'});

export function createDurableHooks({directory,reader}) {
  const root = directory && path.isAbsolute(directory) ? fs.realpathSync(directory) : null;
  const assertContext = () => {
    if (!root || fs.realpathSync(directory) !== root || !fs.statSync(root).isDirectory()) throw new Error('Native project directory changed or unavailable');
    // Hooks have no ask: only core-authorized prepared metadata under this trusted root is writable.
    const metadata = path.join(root,'.pulso');
    if (fs.existsSync(metadata) && fs.realpathSync(metadata) !== metadata) throw new Error('External metadata tree is not allowed');
  };
  async function matched(args) {
    if (typeof args?.prompt !== 'string') return null;
    // Find the identity even when the task list or the rest of the prompt was edited.
    const candidates = [...args.prompt.matchAll(/^Encargo: ([A-Za-z0-9][A-Za-z0-9_-]{0,79}) · workId: ([A-Za-z0-9][A-Za-z0-9_-]{0,79})(?= ·|$)/gm)];
    // Direct initialization/review has no durable identity and needs no Work.
    // Never bypass a matched managed contract based on a mode label in the prompt.
    if (!candidates.length) return null;
    if (!root || fs.realpathSync(directory) !== root) throw new Error('Native project directory changed or unavailable');
    // Absence is legacy, not a failed managed dispatch. An existing registry with
    // missing identity/snapshot is corruption: never swallow nested ENOENT there.
    const registry = root && path.join(root,'.pulso/delegations-v2.json');
    if (!registry) return null;
    try { fs.lstatSync(registry); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (fs.existsSync(path.join(root,'.pulso/delegations-v2'))) throw new Error('Durable registry missing while delegation blobs exist; recover authority before dispatch');
      return null;
    }
    assertContext();
    for (const [,delegationId,workId] of candidates) {
      let record;
      try { record = await readDelegation(root,{workId,delegationId}); }
      catch (error) {
        if (error.code === 'DELEGATION_NOT_FOUND' || error.message === 'Encargo no encontrado o continuidad ajena') continue;
        throw error;
      }
      if (!record || record.contractVersion !== 2) continue;
      const ids = correlation(args.prompt);
      const differences = [];
      if (candidates.length !== 1) differences.push(`header(identityCount=${candidates.length}, expected=1)`);
      else if (!ids.taskIds || ids.delegationId !== delegationId || ids.workId !== workId) differences.push('header(invalid or ambiguous task header)');
      if (record.delegation.agent !== args.agent) differences.push(`role(expected=${roleLabel(record.delegation.agent)}, received=${roleLabel(args.agent)})`);
      if (JSON.stringify(record.delegation.taskIds) !== JSON.stringify(ids.taskIds)) differences.push('task(taskIds differ in value, order or availability)');
      if (record.specialistPrompt !== args.prompt) differences.push(promptDifference(record.specialistPrompt,args.prompt));
      if (differences.length) throw new Error(`Managed delegation prompt, role or tasks differ from the canonical snapshot: ${differences.join('; ')}`);
      // V2 persists Tool.Called input before before-hooks. Never rewrite bytes
      // here: that would diverge executed child input from native proof.
      return {workId,delegationId};
    }
    return null;
  }
  async function sessionProof(sessionID, expectedParent) {
    if (!reader || !nonempty(sessionID)) throw new Error('Native session proof unavailable');
    const session = await reader.getSession(sessionID);
    if (session.id !== sessionID || !nonempty(session.projectID) || !session.location?.directory || fs.realpathSync(session.location.directory) !== root || (expectedParent !== undefined && session.parentID !== expectedParent)) throw new Error('Native session belongs to another project or parent');
    return session;
  }
  async function capture(input, result, {literal,childSessionID,terminal=false} = {}) {
    let ids;
    const rawResult = !terminal;
    try {
      ids = await matched(input.input);
      if (!ids) return null;
      assertContext();
      const record = readDelegation(root,ids);
      if (!record.attempts.some(a => a.sessionID === input.sessionID && a.callID === input.id)) throw new Error('Native return has no matching persisted parent/call');
      const metadata = result?.metadata;
      if (!terminal) {
        const output = result?.output;
        childSessionID = output?.sessionID;
        literal = textContent(result?.content);
        terminal = output?.status === 'completed' && nonempty(childSessionID) && typeof output.output === 'string'
          && metadata?.sessionID === childSessionID && metadata?.status === 'completed'
          && literal === `<subagent sessionID="${childSessionID}" state="completed">\n${output.output}\n</subagent>`;
      }
      if (!terminal || typeof literal !== 'string' || !nonempty(childSessionID)) return pending(ids,'Native terminal result and parent/child correlation are not confirmed');
      const parent = await sessionProof(input.sessionID), child = await sessionProof(childSessionID,input.sessionID);
      if (parent.projectID !== child.projectID) throw new Error('Native child belongs to another project');
      assertContext();
      // The builtin's raw Tool.Result is before host presentation truncation.
      // Its exact output/content pair contains the full returned bytes. Persisted
      // replay instead needs the host's explicit truncation marker.
      const completeness = metadata?.truncated === true ? 'truncated' : rawResult || metadata?.truncated === false ? 'complete' : 'unknown';
      const saved = await recordNativeReturn(root,{...ids,sessionID:input.sessionID,callID:input.id,markdown:literal,childSessionID,completeness},{assertContext});
      const returnId = typeof saved === 'string' ? saved : saved?.returnId;
      if (!returnId) throw new Error('Core did not return a durable returnId');
      return {...ids,returnId,capture:'stored',completeness,acceptance:'not_assessed'};
    } catch(error) {return {...ids,capture:'pending',acceptance:'not_assessed',error:String(error.message).slice(0,500),...(error.code ? {code:error.code} : {})};}
  }
  const api = {
    async before(event) {
      if (event.tool !== 'subagent') return;
      const ids = await matched(event.input);
      if (!ids) return;
      const host = nativeContext(event);
      if (!host.sessionID || !host.messageID || !host.callID || event.agent !== 'pulso') throw new Error('Managed dispatch requires native primary session/message/call identity');
      const parent = await sessionProof(event.sessionID);
      if (parent.parentID) throw new Error('Managed dispatch requires the primary session');
      assertContext();
      const assertDispatchContext = () => {
        assertContext();
        const record = readDelegation(root,ids);
        if (record.hostContext?.projectRoot !== root) throw new Error('Managed dispatch requires preparation authorized in this project');
        if (record.attempts.length) throw new Error('Managed delegation already dispatched; reconcile by ID');
      };
      await recordNativeDispatch(root,{...ids,sessionID:host.sessionID,callID:host.callID,agent:event.input.agent,prompt:event.input.prompt},{assertContext:assertDispatchContext});
    },
    async after(event) {
      if (event.tool !== 'subagent') return;
      const receipt = await capture(event,event.status === 'completed' ? event.result : null);
      if (receipt && event.status === 'completed') event.result.metadata = {...event.result.metadata,pulsoDurable:receipt};
      return receipt;
    },
    async replay({sessionID,messageID,part,completion}) {
      if (completion) return api.synthetic({sessionID,message:completion});
      if (part?.type !== 'tool' || part.name !== 'subagent') return null;
      const metadata = part.state?.metadata, childSessionID = metadata?.sessionID, literal = textContent(part.state?.content);
      const prefix = `<subagent sessionID="${childSessionID}" state="completed">\n`;
      const terminal = part.executed !== true && part.state?.status === 'completed' && metadata?.status === 'completed' && nonempty(childSessionID) && typeof literal === 'string' && literal.startsWith(prefix) && literal.endsWith('\n</subagent>');
      return capture({sessionID,messageID,id:part.id,input:part.state?.input},{metadata},{literal,childSessionID,terminal});
    },
    async synthetic({sessionID,message}) {
      const metadata = message?.metadata;
      if (message?.type !== 'synthetic' || metadata?.source !== 'subagent' || !nonempty(metadata.childID)) return null;
      if (metadata.state !== 'completed') return pending({},'Background child is not confirmed completed');
      const messages = await reader.history(sessionID);
      const matches = messages.flatMap(owner => owner.type === 'assistant' && owner.agent === 'pulso' ? (owner.content || []).filter(part => part.type === 'tool' && part.name === 'subagent' && part.state?.metadata?.sessionID === metadata.childID).map(part => ({part,owner})) : []);
      if (matches.length !== 1) return pending({},'Background parent call is missing or ambiguous');
      const {part,owner} = matches[0];
      if (part.executed === true || part.state?.metadata?.status !== 'running' || part.state?.input?.agent !== metadata.agent || typeof message.text !== 'string' || !message.text.startsWith(`<subagent sessionID="${metadata.childID}" state="completed" description="`) || !message.text.endsWith('\n</subagent>')) return pending({},'Background terminal metadata is inconsistent');
      return capture({sessionID,messageID:owner.id,id:part.id,input:part.state.input},{metadata},{literal:message.text,childSessionID:metadata.childID,terminal:true});
    },
    async event(event) {
      const data = event?.data;
      if (!data || !nonempty(data.sessionID)) return null;
      // Events are volatile. Fetch durable native messages and independently check
      // their session; never infer terminal capture from prose or a launch result.
      if (['session.synthetic','session.inbox.delivered'].includes(event.type)) {
        // Native admission delivers synthetic child notifications through inbox;
        // direct session.synthetic remains a separate official event path.
        const messageID = event.type === 'session.inbox.delivered' ? data.inboxID : typeof event.id === 'string' && event.id.startsWith('evt_') ? event.id.replace(/^evt_/, 'msg_') : null;
        if (!messageID) return null;
        const message = await reader.getMessage(data.sessionID,messageID);
        return api.synthetic({sessionID:data.sessionID,message});
      }
      if (!['session.tool.success','session.tool.failed'].includes(event.type)) return null;
      const message = await reader.getMessage(data.sessionID,data.assistantMessageID);
      if (message?.type !== 'assistant' || message.agent !== 'pulso') return null;
      const parts = message.content.filter(part => part.type === 'tool' && part.id === data.id);
      if (parts.length !== 1) return null;
      return api.replay({sessionID:data.sessionID,messageID:message.id,part:parts[0]});
    },
  };
  return api;
}
