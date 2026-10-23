/** OpenCode 2.1.2 recovery: native full-history replay, never model context.
 * Observation is not approval, acceptance, or physical cessation. */
import fs from 'node:fs';
import path from 'node:path';
import {contentHash, inspectContinuities, readContinuity} from '../resources/lib/continuity.mjs';
import {discoverContinuities} from '../resources/lib/continuity-discovery.mjs';
import {listDelegations, readDelegation} from '../resources/lib/delegation-registry.mjs';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const marker = '<pulso_continuity_observation>';
const fail = (message, code = 'AUTOMATIC_RECOVERY_UNAVAILABLE') => Object.assign(new Error(message), {code});
const sameRoot = (directory, root) => {try {return typeof directory === 'string' && fs.realpathSync(directory) === root;} catch {return false;}};
function partsOf(message) {
  if (!nonempty(message?.id) || !nonempty(message.type)) throw fail('Historial nativo incompleto');
  if (message.type !== 'assistant') return [];
  if (!Array.isArray(message.content)) throw fail('Contenido nativo incompleto');
  return message.content;
}
function realText(message) {
  if (message?.type === 'user') return typeof message.text === 'string' ? message.text : '';
  return partsOf(message).filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('\n');
}
async function sessionProof(reader, root, sessionID) {
  const session = await reader.getSession(sessionID);
  if (session?.id !== sessionID || !nonempty(session.projectID) || !sameRoot(session.location?.directory, root) || session.parentID || session.agent !== 'pulso') throw fail('La recuperación sólo corresponde al primario del proyecto');
  return session;
}
async function history(reader, root, sessionID, maxMessages) {
  const session = await reader.getSession(sessionID);
  if (session?.id !== sessionID || !sameRoot(session.location?.directory, root)) throw fail('Historial nativo de otra raíz');
  const messages = await reader.history(sessionID,{maxMessages});
  if (!Array.isArray(messages) || messages.length > maxMessages || messages.some(message => !nonempty(message?.id) || !nonempty(message.type)) || new Set(messages.map(value => value.id)).size !== messages.length) throw fail('Historial nativo ausente, ambiguo o fuera del límite');
  messages.forEach(partsOf);
  return messages;
}
const isInput = message => ['user','synthetic','compaction'].includes(message?.type);
async function userRequest(reader, root, session, userMessageID, maxMessages, assistantMessageID) {
  const messages = await history(reader, root, session.id, maxMessages);
  const message = messages.find(value => value.id === userMessageID);
  if (message?.type !== 'user' || !realText(message).trim()) throw fail('Una notificación sintética no autoriza recuperación');
  const lastInput = messages.findLast(isInput);
  if (lastInput?.id !== userMessageID) throw fail('La petición nativa cambió', 'AUTOMATIC_RECOVERY_STALE');
  if (assistantMessageID) {
    const index = messages.findIndex(value => value.id === assistantMessageID), assistant = messages[index];
    if (assistant?.type !== 'assistant' || assistant.agent !== 'pulso' || index < messages.indexOf(message) || messages.slice(index+1).some(isInput)) throw fail('Assistant nativo no corresponde a la petición actual', 'AUTOMATIC_RECOVERY_STALE');
  }
  const text = realText(message);
  return {sessionID:session.id,userMessageID,textHash:contentHash(text),text};
}

/** Authentic reference and text, not semantic proof of approval. No model-supplied identity. */
export async function nativePrimaryRequest(reader, context, root, {maxMessages = 500} = {}) {
  if (context?.agent !== 'pulso' || !nonempty(context.sessionID) || !nonempty(context.messageID) || context.signal?.aborted) throw fail('Identidad primaria actual no disponible');
  const session = await sessionProof(reader, root, context.sessionID);
  const assistant = await reader.getMessage(session.id,context.messageID);
  if (assistant?.id !== context.messageID || assistant.type !== 'assistant' || assistant.agent !== 'pulso') throw fail('Assistant nativo no corresponde a la invocación');
  const messages = await history(reader,root,session.id,maxMessages);
  const index = messages.findIndex(value => value.id === assistant.id);
  const input = messages.slice(0,index).findLast(isInput);
  if (index < 0 || input?.type !== 'user') throw fail('No hay petición auténtica previa al assistant');
  const request = await userRequest(reader,root,session,input.id,maxMessages,assistant.id);
  return {session,request:{...request,assistantMessageID:context.messageID}};
}

/** Native active map + terminal outcome. Idle alone never proves interruption. */
function classifySession({session,messages,statusMap,projectRoot,projectID,expectedAgent='pulso',parentSessionID=null}) {
  const unknown = {status:'unknown',interruption:'unknown',physicalCessation:'unknown'};
  if (!session || !sameRoot(session.location?.directory,projectRoot) || session.projectID !== projectID || (session.parentID ?? null) !== parentSessionID || session.agent !== expectedAgent || !Array.isArray(messages) || !statusMap || typeof statusMap !== 'object' || Array.isArray(statusMap)) return unknown;
  if (Object.values(statusMap).some(value => value?.type !== 'running')) return unknown;
  const last = messages.findLast(message => message?.type === 'assistant');
  const status = statusMap[session.id] ? (last?.retry ? 'retry' : 'busy') : 'idle';
  const base = {status,interruption:'none',physicalCessation:'unknown'};
  if (status !== 'idle') return base;
  if (session.outcome === 'interrupted') return {...base,interruption:'user_abort'};
  if (!last || last.agent !== expectedAgent || messages.slice(messages.indexOf(last)+1).some(message => message.type === 'user')) return {...base,interruption:'unknown'};
  if (session.outcome === 'failed' && last.error && nonempty(last.error.type) && last.time?.completed !== undefined) return {...base,interruption:'terminal_error',errorMessageID:last.id,errorName:last.error.type};
  return base;
}
export const classifyOwner = input => classifySession(input);

/** The semantic disposition is the coordinator's interpretation, never inferred by regex. */
export function recoveryDecision(observation, disposition = 'review_required') {
  if (['new_goal', 'pause', 'cancel', 'status_only'].includes(disposition)) return {eligible: false, reason: disposition};
  if (!observation?.complete) return {eligible: false, reason: 'incomplete'};
  if (observation.candidates.length !== 1) return {eligible: false, reason: observation.candidates.length ? 'ambiguous' : 'no_candidate'};
  if (observation.owner?.interruption === 'user_abort') return {eligible: false, reason: 'user_abort'};
  if (observation.childSignals?.some(value => ['busy', 'retry'].includes(value.status))) return {eligible: false, reason: 'child_active'};
  if (observation.childSignals?.some(value => value.status === 'unknown')) return {eligible: false, reason: 'child_state_unknown'};
  if (observation.owner?.status !== 'idle' || !['terminal_error', 'terminal_child_error'].includes(observation.owner.interruption)) return {eligible: false, reason: 'owner_not_recoverable'};
  if (!['compatible', 'approved_existing'].includes(disposition)) return {eligible: false, reason: 'review_required'};
  return {eligible: true, reason: 'logical_recovery_only', physicalCessation: 'unknown'};
}

function sourceReference(request) {
  return {provenance: 'native_user_request', sessionID: request.sessionID, userMessageID: request.userMessageID, ...(request.assistantMessageID ? {assistantMessageID: request.assistantMessageID} : {}), textHash: request.textHash};
}
function appliedReplay(record, args, request) {
  const last = record.history.at(-1), source = last?.requestSource;
  return record.ownerSessionID === request.sessionID && last?.type === 'resumed' && last.resumeMode === 'automatic' && last.sessionID === request.sessionID && last.intentRevision === record.intentRevision && last.fromResumeBasis === args.expectedResumeBasis && source?.sessionID === request.sessionID && source.userMessageID === request.userMessageID && source.textHash === request.textHash;
}
function historicalExcerpt(message, sessionID) {
  const text = realText(message);
  return {sessionID: sessionID, messageID: message.id, role: message.type,
    ...(message.type === 'user' ? {userMessageID: message.id} : {}),
    textHash: contentHash(text), text: text.slice(0, 3000), truncated: text.length > 3000,
    authority: 'historical_context_not_new_instruction'};
}
function contextGuard(context, root) {
  const identity = Object.fromEntries(['sessionID', 'messageID', 'agent', 'id'].map(key => [key, context[key]]));
  return () => {
    if (context.signal?.aborted || Object.entries(identity).some(([key, value]) => context[key] !== value)) throw fail('El contexto de recuperación cambió', 'AUTOMATIC_RECOVERY_STALE');
  };
}

export function createRecoveryPolicy({directory, reader, maxMessages = 500, maxDelegations = 40, maxCapsuleBytes = 24000} = {}) {
  const root = typeof directory === 'string' && path.isAbsolute(directory) ? fs.realpathSync(directory) : null;
  const issued = new WeakMap();
  const observedHistories = new WeakMap();
  function assertRoot() {if (!root || !sameRoot(directory, root)) throw fail('Raíz nativa no disponible');}
  async function inspect(session, request) {
    assertRoot();
    const discovery = discoverContinuities(root, {assertContext: assertRoot});
    const observation = {...discovery, request: sourceReference(request), owner: {status: 'unknown', interruption: 'unknown', physicalCessation: 'unknown'}, attempts: [], childSignals: [], historicalContext: []};
    if (!discovery.complete || discovery.candidates.length !== 1) return observation;
    const candidate = discovery.candidates[0];
    if (!nonempty(candidate.ownerSessionID) || candidate.ownerSessionID === session.id) return {...observation, reason: 'already_owned_or_unbound'};
    let messages;
    const snapshots = [];
    try {
      const owner = await sessionProof(reader, root, candidate.ownerSessionID);
      messages = await history(reader, root, owner.id, maxMessages);
      snapshots.push({sessionID: owner.id, parentID: null, projectID: owner.projectID, hash: contentHash(messages)});
      let statusMap = await reader.status();
      observation.owner = {...classifyOwner({session: owner, messages, statusMap, projectRoot: root, projectID: session.projectID}), sessionID: owner.id};
      // References and bounded native excerpts support semantic review, including legacy.
      // Persisted sourceText is deliberately never used as proof or copied into this capsule.
      observation.historicalContext = messages.filter(value => ['user', 'assistant'].includes(value.type) && realText(value).trim()).slice(-8).map(message => historicalExcerpt(message,owner.id));
      const reference = candidate.intentSource;
      if (reference) {
        observation.intentSourceStatus = 'unverified';
        try {
          if (reference.provenance !== 'native_user_request' || !nonempty(reference.sessionID) || !nonempty(reference.userMessageID) || !nonempty(reference.textHash) || reference.intentRevision !== undefined && reference.intentRevision !== candidate.intentRevision) throw fail('Referencia histórica inválida');
          const sourceSession = reference.sessionID === owner.id ? owner : await sessionProof(reader, root, reference.sessionID);
          if (sourceSession.projectID !== session.projectID) throw fail('Fuente histórica de otro proyecto');
          const sourceMessages = reference.sessionID === owner.id ? messages : await history(reader, root, reference.sessionID, maxMessages);
          const index = sourceMessages.findIndex(value => value.id === reference.userMessageID && value.type === 'user');
          if (index < 0 || contentHash(realText(sourceMessages[index])) !== reference.textHash) throw fail('La fuente histórica cambió');
          observation.intentSourceStatus = 'native_reference_verified_not_semantic_approval';
          const existing = new Set(observation.historicalContext.map(value => `${value.sessionID}:${value.messageID}`));
          for (const message of sourceMessages.slice(Math.max(0, index - 3), index + 1)) if (realText(message).trim() && !existing.has(`${sourceSession.id}:${message.id}`)) observation.historicalContext.push(historicalExcerpt(message,sourceSession.id));
        } catch { /* An unavailable optional reference does not invalidate readable legacy context. */ }
      }
      const records = listDelegations(root, {continuityId: candidate.continuityId});
      if (records.length > maxDelegations) return {...observation, complete: false, reason: 'delegation_limit'};
      const children = [];
      for (const entry of records) {
        const record = readDelegation(root, {workId: entry.workId, delegationId: entry.delegationId});
        for (const attempt of record.attempts) {
          const matches = messages.flatMap(message => message.type === 'assistant' && message.agent === 'pulso' ? message.content.filter(part => part.type === 'tool' && part.name === 'subagent' && part.id === attempt.callID && part.state?.input?.prompt === record.specialistPrompt && part.state.input.agent === record.delegation.agent) : []);
          observation.attempts.push({delegationId: record.delegationId, sessionID: attempt.sessionID, callID: attempt.callID, resolution: attempt.resolution, nativeStatus: matches.length === 1 ? matches[0].state.status : 'unknown', physicalCessation: 'unknown', returnIds: record.returns.map(value => value.returnId)});
          if (attempt.resolution !== 'unresolved') continue;
          const unknownChild = {delegationId: record.delegationId, callID: attempt.callID, status: 'unknown', interruption: 'unknown', physicalCessation: 'unknown'};
          if (attempt.sessionID !== owner.id || matches.length !== 1) {observation.childSignals.push({...unknownChild, reason: 'child_identity_unavailable'});continue;}
          const metadata = matches[0].state?.metadata, childID = metadata?.sessionID;
          if (!nonempty(childID) || messages.flatMap(partsOf).filter(part => part.type === 'tool' && part.name === 'subagent' && part.state?.metadata?.sessionID === childID).length !== 1) {observation.childSignals.push({...unknownChild, reason: 'child_identity_ambiguous'});continue;}
          try {
            const child = await reader.getSession(childID);
            if (child?.id !== childID || child.parentID !== owner.id || child.projectID !== session.projectID || !sameRoot(child.location?.directory, root)) throw fail('Relación nativa del hijo no verificada');
            const childMessages = await history(reader, root, childID, maxMessages);
            snapshots.push({sessionID: childID, parentID: owner.id, projectID: child.projectID, hash: contentHash(childMessages)});
            children.push({session: child, messages: childMessages, expectedAgent: record.delegation.agent, parentSessionID: owner.id, delegationId: record.delegationId, callID: attempt.callID,
              currentIntent: !record.retired && record.intentId === candidate.intentId && (record.intentRevision === candidate.intentRevision || candidate.compatibleDelegationIds.includes(record.delegationId))});
          } catch {observation.childSignals.push({sessionID: childID, delegationId: record.delegationId, callID: attempt.callID, status: 'unknown', interruption: 'unknown', physicalCessation: 'unknown'});}
        }
      }
      if (children.length) {
        // Re-read status after child I/O; neither parent nor child idle alone is failure.
        statusMap = await reader.status();
        observation.owner = {...classifyOwner({session: owner, messages, statusMap, projectRoot: root, projectID: session.projectID}), sessionID: owner.id};
        for (const child of children) {
          const signal = classifySession({...child, statusMap, projectRoot: root, projectID: session.projectID});
          const nonterminalTools = child.messages.flatMap(partsOf).filter(part => part.type === 'tool' && !['completed', 'error'].includes(part.state?.status)).map(part => ({tool: part.name, callID: part.id, status: part.state?.status ?? 'unknown'}));
          observation.childSignals.push({...signal, sessionID: child.session.id, delegationId: child.delegationId, callID: child.callID, currentIntent: child.currentIntent, hostToolsAllTerminal: nonterminalTools.length === 0, nonterminalTools});
        }
        if (observation.childSignals.some(value => value.interruption === 'user_abort')) observation.owner.interruption = 'user_abort';
        else if (observation.owner.status === 'idle' && observation.owner.interruption === 'none' && observation.childSignals.some(value => value.currentIntent && value.status === 'idle' && value.interruption === 'terminal_error')) observation.owner.interruption = 'terminal_child_error';
      }
    } catch {observation.owner = {status: 'unknown', interruption: 'unknown', physicalCessation: 'unknown'};}
    assertRoot();
    observedHistories.set(observation, snapshots);
    return observation;
  }
  function assertProof(proof, args, context) {
    const saved = issued.get(proof);
    if (!saved) throw fail('Falta prueba privada del adaptador');
    saved.guard();
    if (context.signal?.aborted || context.sessionID !== proof.sessionID || context.messageID !== proof.assistantMessageID || context.agent !== 'pulso' || args.workId !== proof.workId || args.continuityId !== proof.continuityId || args.expectedResumeBasis !== proof.expectedResumeBasis) throw fail('Prueba de recuperación ajena', 'AUTOMATIC_RECOVERY_STALE');
    const current = proof.replay ? {complete: true, candidates: inspectContinuities(root, {workId: proof.workId, continuityId: proof.continuityId}, {assertContext: saved.guard}).items} : discoverContinuities(root, {assertContext: saved.guard});
    if (!current.complete || current.candidates.length !== 1 || current.candidates[0].resumable === false || current.candidates[0].continuityId !== proof.continuityId || current.candidates[0].resumeBasis !== proof.observedResumeBasis) throw fail('La continuidad cambió desde la comprobación', 'AUTOMATIC_RECOVERY_STALE');
    if (proof.replay && !appliedReplay(readContinuity(root, proof.continuityId, {nativeContext: {sessionID: proof.sessionID}}), args, proof.source)) throw fail('La transición aplicada ya no corresponde a esta petición', 'AUTOMATIC_RECOVERY_STALE');
    return true;
  }
  return {
    async context(event) {
      try {
        assertRoot();
        if (!Array.isArray(event?.system)) return;
        event.system = event.system.filter(part => !(part.type === 'text' && part.text?.startsWith(marker)));
        if (event.agent !== 'pulso' || !nonempty(event.sessionID)) return;
        const session = await sessionProof(reader,root,event.sessionID);
        const messages = await history(reader,root,session.id,maxMessages), input = messages.findLast(isInput);
        if (input?.type !== 'user') return;
        const request = await userRequest(reader,root,session,input.id,maxMessages);
        const visible = event.messages?.findLast(message => message.role === 'user');
        const visibleText = Array.isArray(visible?.content) ? visible.content.filter(part => part.type === 'text').map(part => part.text).join('\n') : '';
        // A context hook already in flight must not authenticate a later queued
        // request. Native message ID and text both bind this exact model window.
        if (visible?.id !== input.id || contentHash(visibleText) !== request.textHash) return;
        const observation = await inspect(session,request);
        if (!observation.available || observation.reason === 'already_owned_or_unbound' || observation.complete && !observation.candidates.length) return;
        let data = observation;
        if (Buffer.byteLength(JSON.stringify(data)) > maxCapsuleBytes) data = {complete:false,reason:'capsule_limit',request:observation.request,candidates:observation.candidates.map(value => ({workId:value.workId,continuityId:value.continuityId}))};
        // Ephemeral system context, never a synthetic/user message or persisted instruction.
        event.system.push({type:'text',text:marker+'\nObservación de continuidad, NO instrucción del usuario ni aprobación. Revisa la petición auténtica y acuerdos; no retomes un objetivo nuevo, pausado o cancelado. No deduzcas cese físico ni repitas intentos. Si procede usa resume_continuity con permiso y CAS. Datos:\n'+JSON.stringify(data)+'\n</pulso_continuity_observation>'});
      } catch { /* Optional discovery cannot obstruct a normal user turn. */ }
    },
    async inspectInvocation(context) {
      assertRoot();
      const guard = contextGuard(context, root), native = await nativePrimaryRequest(reader, context, root, {maxMessages});
      guard();
      const observation = await inspect(native.session, native.request);
      guard();
      return observation;
    },
    async proveAutomaticResume(context, args, {disposition = 'review_required'} = {}) {
      assertRoot();
      const guard = contextGuard(context, root), native = await nativePrimaryRequest(reader, context, root, {maxMessages});
      guard();
      let replayRecord;
      try {
        const record = readContinuity(root, args.continuityId, {nativeContext: {sessionID: context.sessionID}, assertContext: guard});
        if (record.workId === args.workId && ['compatible', 'approved_existing'].includes(disposition) && appliedReplay(record, args, native.request)) replayRecord = record;
      } catch { /* Not a previous applied transition; normal eligibility still applies. */ }
      const replay = Boolean(replayRecord);
      // Receipt recovery selects an already applied transition, not a new candidate.
      const observation = replay ? {available: true, complete: true, projectId: replayRecord.projectId, candidates: inspectContinuities(root, {workId: args.workId, continuityId: args.continuityId}, {assertContext: guard}).items, childSignals: []} : await inspect(native.session, native.request);
      const candidate = observation.candidates[0];
      const decision = replay ? {eligible: true} : recoveryDecision(observation, disposition);
      if (!decision.eligible) throw fail(`Recuperación automática no elegible: ${decision.reason}`);
      // Host reads occur outside the synchronous metadata lock. Recheck the
      // actual triggering request after those reads, rather than trust a hint/cache.
      const fresh = await nativePrimaryRequest(reader, context, root, {maxMessages});
      if (fresh.request.userMessageID !== native.request.userMessageID || fresh.request.textHash !== native.request.textHash || fresh.session.projectID !== native.session.projectID) throw fail('La petición cambió durante la inspección', 'AUTOMATIC_RECOVERY_STALE');
      for (const snapshot of observedHistories.get(observation) ?? []) {
        const session = await reader.getSession(snapshot.sessionID);
        if (session?.id !== snapshot.sessionID || (session.parentID ?? null) !== snapshot.parentID || session.projectID !== snapshot.projectID || !sameRoot(session.location?.directory, root) || contentHash(await history(reader, root, snapshot.sessionID, maxMessages)) !== snapshot.hash) throw fail('Cambió la sesión observada durante la comprobación', 'AUTOMATIC_RECOVERY_STALE');
      }
      // Source authentication also awaits the host. A final status observation
      // catches known activity that appeared during it; still not a host lease.
      if (!replay) {
        const finalStatus = await reader.status();
        if (!finalStatus || typeof finalStatus !== 'object' || Array.isArray(finalStatus) || Object.values(finalStatus).some(value => !value || value.type !== 'running') || [observation.owner.sessionID, ...observation.childSignals.map(value => value.sessionID)].some(id => finalStatus[id]?.type === 'running')) throw fail('El host ahora informa actividad o estado incierto', 'AUTOMATIC_RECOVERY_STALE');
      }
      const previousOwner = replay ? readContinuity(root, candidate.continuityId, {nativeContext: {sessionID: context.sessionID}}).history.at(-1).previousSessionID : null;
      const proof = Object.freeze({kind: 'automatic_continuity_recovery', projectRoot: root, projectId: observation.projectId, sessionID: context.sessionID, assistantMessageID: context.messageID, workId: candidate.workId, continuityId: candidate.continuityId, expectedResumeBasis: args.expectedResumeBasis, observedResumeBasis: candidate.resumeBasis, intentId: candidate.intentId, intentRevision: candidate.intentRevision, source: Object.freeze(sourceReference(native.request)), owner: Object.freeze(replay ? {sessionID: previousOwner, status: 'idle', interruption: 'applied_transition', physicalCessation: 'unknown'} : {...observation.owner}), replay: Boolean(replay), physicalCessation: 'unknown'});
      issued.set(proof, {guard, observation, nativeProjectID: native.session.projectID});
      assertProof(proof, args, context);
      return proof;
    },
    assertProof,
    /** Call only after an approved successful resume; never from discovery or a read tool. */
    async replayStoredReturns(proof, receipt, replayPart) {
      const saved = issued.get(proof);
      if (!saved || typeof replayPart !== 'function' || receipt?.ok !== true || receipt.data?.ownerSessionID !== proof.sessionID || receipt.data?.continuityId !== proof.continuityId) throw fail('Replay requiere una retoma confirmada');
      saved.guard();
      const continuity = readContinuity(root, proof.continuityId, {nativeContext: {sessionID: proof.sessionID}, assertContext: saved.guard});
      if (continuity.intentId !== proof.intentId || continuity.intentRevision !== proof.intentRevision) throw fail('Intención cambió antes del replay');
      const stored = [], pending = [];
      const records = listDelegations(root, {continuityId: proof.continuityId});
      if (records.length > maxDelegations) return {ownerTransferred: true, stored, pending: [{reason: 'delegation_limit'}]};
      const cache = new Map();
      for (const entry of records) {
        const record = readDelegation(root, {workId: entry.workId, delegationId: entry.delegationId});
        for (const attempt of record.attempts.filter(value => value.resolution === 'unresolved')) {
          try {
            saved.guard();
            if (!cache.has(attempt.sessionID)) {
              const parent = await sessionProof(reader, root, attempt.sessionID);
              if (parent.projectID !== saved.nativeProjectID) throw fail('El retorno pertenece a otro proyecto nativo');
              const messages = await history(reader, root, parent.id, maxMessages);
              cache.set(parent.id, messages);
            }
            const matches = cache.get(attempt.sessionID).flatMap(message => message.type === 'assistant' && message.agent === 'pulso' ? message.content.filter(part => part.type === 'tool' && part.name === 'subagent' && part.id === attempt.callID).map(part => ({messageID:message.id,part})) : []);
            if (matches.length !== 1) throw fail('ToolPart no disponible o ambiguo');
            const {part,messageID} = matches[0];
            if (part.state?.status !== 'completed' || part.state.input?.prompt !== record.specialistPrompt || part.state.input.agent !== record.delegation.agent) throw fail('Retorno terminal no confirmado');
            const childID = part.state.metadata?.sessionID;
            if (!nonempty(childID)) throw fail('Retorno sin identidad nativa del hijo');
            const child = await reader.getSession(childID);
            if (child.parentID !== attempt.sessionID || child.projectID !== saved.nativeProjectID || child.agent !== record.delegation.agent || !sameRoot(child.location?.directory,root)) throw fail('Relación del retorno hijo no confirmada');
            let completion;
            if (part.state.metadata?.status === 'running') {
              const notifications = cache.get(attempt.sessionID).filter(message => message.type === 'synthetic' && message.metadata?.source === 'subagent' && message.metadata.childID === childID);
              if (notifications.length !== 1 || notifications[0].metadata.agent !== record.delegation.agent || notifications[0].metadata.state !== 'completed') throw fail('Finalización background ausente o ambigua');
              completion = notifications[0];
            }
            saved.guard();
            readContinuity(root, proof.continuityId, {nativeContext: {sessionID: proof.sessionID}, assertContext: saved.guard});
            // The existing durable validator must still verify the exact terminal wrapper/child.
            const result = await replayPart({sessionID:attempt.sessionID,messageID,part:structuredClone(part),...(completion ? {completion:structuredClone(completion)} : {})});
            if (result?.capture === 'stored') stored.push(result); else pending.push({delegationId: record.delegationId, ...result});
          } catch (error) {pending.push({delegationId: record.delegationId, callID: attempt.callID, reason: error.code ?? 'native_return_unavailable'});}
        }
      }
      return {ownerTransferred: true, stored, pending, physicalCessation: 'unknown', childSignals: saved.observation.childSignals};
    },
  };
}
