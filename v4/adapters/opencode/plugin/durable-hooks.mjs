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
  return Object.fromEntries(['sessionID','messageID','callID'].filter(key => typeof context?.[key] === 'string' && context[key].trim()).map(key => [key, context[key]]));
}

// No XML decoding, trimming, or inference from report prose. The literal native output is stored.
function terminalEnvelope(literal, metadata, sessionID) {
  if (typeof literal !== 'string') return false;
  const match = /^<task id="(ses_[A-Za-z0-9_-]+)" state="completed">\n<task_result>([\s\S]*)<\/task_result>\n<\/task>$/.exec(literal);
  if (!match || /<\/?(?:task|task_result)(?:\s|>)/.test(match[2])) return false;
  return typeof sessionID === 'string' && sessionID.length > 0 && metadata?.parentSessionId === sessionID && metadata.sessionId === match[1]
    && (metadata.status === undefined || metadata.status === 'completed');
}

export function createDurableHooks({directory}) {
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
      if (record.delegation.agent !== args.subagent_type) differences.push(`role(expected=${roleLabel(record.delegation.agent)}, received=${roleLabel(args.subagent_type)})`);
      if (JSON.stringify(record.delegation.taskIds) !== JSON.stringify(ids.taskIds)) differences.push('task(taskIds differ in value, order or availability)');
      if (record.specialistPrompt !== args.prompt) differences.push(promptDifference(record.specialistPrompt,args.prompt));
      if (differences.length) throw new Error(`Managed delegation prompt, role or tasks differ from the canonical snapshot: ${differences.join('; ')}`);
      return {workId,delegationId};
    }
    return null;
  }
  function annotate(output, value) {
    output.metadata = {...output.metadata,pulsoDurable:value};
    // Metadata is separate from the original response. Never replace or append to specialist bytes.
  }
  async function capture(input, output, {eventStatus,fromEvent=false} = {}) {
    let ids;
    try {
      ids = await matched(input.args);
      if (!ids) return null;
      assertContext();
      const record = readDelegation(root,ids);
      if (!record.attempts.some(a => a.sessionID === input.sessionID && a.callID === input.callID)) throw new Error('Native return has no matching persisted parent/call');
      const metadata = output.metadata || {};
      if ((!fromEvent && input.args?.background === true) || (fromEvent && eventStatus !== 'completed') || !terminalEnvelope(output.output,metadata,input.sessionID)) {
        return {...ids,capture:'pending',reason:'Native terminal wrapper and parent/child correlation are not confirmed',acceptance:'not_assessed'};
      }
      const markdown = output.output; // Full original native literal, never just the inner report.
      const completeness = metadata.truncated === false ? 'complete' : metadata.truncated === true ? 'truncated' : 'unknown';
      const result = await recordNativeReturn(root,{...ids,sessionID:input.sessionID,callID:input.callID,markdown,childSessionID:metadata.sessionId,completeness},{assertContext});
      const returnId = typeof result === 'string' ? result : result?.returnId;
      if (!returnId) throw new Error('Core did not return a durable returnId');
      return {...ids,returnId,capture:'stored',completeness,acceptance:'not_assessed'};
    } catch (error) {
      return {...ids,capture:'pending',acceptance:'not_assessed',error:String(error.message).slice(0,500),...(error.code ? {code:error.code} : {})};
    }
  }
  return {
    async 'tool.execute.before'(input, output) {
      if (input.tool !== 'task') return;
      const ids = await matched(output.args);
      if (!ids) return;
      const host = nativeContext(input);
      if (!host.sessionID || !host.callID) throw new Error('Managed dispatch requires native sessionID and callID');
      assertContext();
      const assertDispatchContext = () => {
        assertContext();
        // Runs again inside the core lock. A repeated hook must not re-emit an idempotent core attempt.
        const record = readDelegation(root,ids);
        if (record.hostContext?.projectRoot !== root) throw new Error('Managed dispatch requires preparation authorized in this project');
        // The immutable snapshot retains its original parent as provenance. The
        // core validates current ownership, including an explicit resumption.
        if (record.attempts.length) throw new Error('Managed delegation already dispatched; reconcile by ID');
      };
      // Core revalidates prepared authorization/parent session, current intent and duplicates under its lock.
      await recordNativeDispatch(root,{...ids,sessionID:host.sessionID,callID:host.callID,agent:output.args.subagent_type,prompt:output.args.prompt},{assertContext:assertDispatchContext});
    },
    async 'tool.execute.after'(input, output) {
      if (input.tool !== 'task') return;
      const receipt = await capture(input,output);
      if (receipt) annotate(output,receipt);
      return receipt;
    },
    // Also callable with a given public native event after a failed write/restart.
    // Does not fetch historical events or depend on volatile before-hook state.
    async event({event}) {
      if (event?.type !== 'message.part.updated') return null;
      const part = event.properties?.part;
      if (part?.type !== 'tool' || part.tool !== 'task' || !part.state) return null;
      return capture({...part,args:part.state.input},{output:part.state.output,metadata:part.state.metadata},{eventStatus:part.state.status,fromEvent:true});
    },
  };
}
