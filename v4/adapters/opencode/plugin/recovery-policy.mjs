/** OpenCode 1.18.2 recovery: observation is not approval, acceptance or physical cessation.
 * Public contracts: packages/plugin/src/index.ts; session/prompt.ts;
 * session/status.ts (idle entries are removed); HTTP handlers/session.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import {contentHash, inspectContinuities, readContinuity} from '../resources/lib/continuity.mjs';
import {discoverContinuities} from '../resources/lib/continuity-discovery.mjs';
import {listDelegations, readDelegation} from '../resources/lib/delegation-registry.mjs';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const errors = new Set(['APIError', 'UnknownError', 'ProviderAuthError', 'MessageOutputLengthError']);
const marker = 'pulso.continuity.observation.v1';
const fail = (message, code = 'AUTOMATIC_RECOVERY_UNAVAILABLE') => Object.assign(new Error(message), {code});
const sameRoot = (directory, root) => {try {return typeof directory === 'string' && fs.realpathSync(directory) === root;} catch {return false;}};
function partsOf(message) {
  if (!message?.info || !Array.isArray(message.parts)) throw fail('Historial nativo incompleto');
  if (message.parts.some(part => part?.sessionID !== message.info.sessionID || part.messageID !== message.info.id)) throw fail('Partes nativas de otro mensaje');
  return message.parts;
}
function realText(message) {
  return partsOf(message).filter(part => part.type === 'text' && !part.synthetic && !part.ignored && typeof part.text === 'string').map(part => part.text).join('\n');
}
async function nativeRead(client, root, method, nativePath, extraQuery = {}) {
  if (typeof client?.session?.[method] !== 'function') throw fail('API nativa de recuperación no disponible');
  let result;
  try {result = await client.session[method]({...(nativePath ? {path: nativePath} : {}), query: {directory: root, ...extraQuery}, throwOnError: true});}
  catch {throw fail('No se pudo consultar el estado nativo');}
  if (result?.error || result?.data === undefined) throw fail('Respuesta nativa incompleta');
  return result.data;
}
async function sessionProof(client, root, sessionID) {
  const session = await nativeRead(client, root, 'get', {id: sessionID});
  if (session?.id !== sessionID || !nonempty(session.projectID) || !sameRoot(session.directory, root) || session.parentID) throw fail('La recuperación sólo corresponde al primario del proyecto');
  return session;
}
async function history(client, root, sessionID, maxMessages) {
  // Pinned MessageV2.page returns the latest limit messages chronologically.
  // Ask for one overflow item: a short page is complete, an overflow is NOT.
  // This bounds host I/O too, unlike an unbounded fetch followed by a local cap.
  const messages = await nativeRead(client, root, 'messages', {id: sessionID}, {limit: maxMessages + 1});
  if (!Array.isArray(messages) || messages.length > maxMessages || messages.some(message => message?.info?.sessionID !== sessionID || !nonempty(message.info.id)) || new Set(messages.map(value => value.info.id)).size !== messages.length) throw fail('Historial nativo ausente, ajeno, ambiguo o fuera del límite');
  messages.forEach(partsOf);
  return messages;
}
async function userRequest(client, root, session, userMessageID, maxMessages, ordinaryTurn = false) {
  const message = await nativeRead(client, root, 'message', {id: session.id, messageID: userMessageID});
  if (message?.info?.id !== userMessageID || message.info.sessionID !== session.id || message.info.role !== 'user' || message.info.agent !== 'pulso') throw fail('La petición nativa no corresponde a Pulso');
  const text = realText(message);
  if (!text.trim()) throw fail('Una notificación sintética no autoriza recuperación');
  const messages = await history(client, root, session.id, maxMessages);
  // A later synthetic user message is a different triggering turn too; fail closed.
  const lastUser = messages.findLast(value => value.info.role === 'user');
  if (lastUser?.info.id !== userMessageID || realText(lastUser) !== text) throw fail('La petición nativa cambió', 'AUTOMATIC_RECOVERY_STALE');
  if (ordinaryTurn) {
    // The same transform is also used by compaction. Its selected old history
    // is not a new primary request. The normal loop persists this assistant
    // BEFORE the hook; compaction persists its helper AFTER its transform.
    const current = messages.at(-1)?.info;
    if (current?.role !== 'assistant' || current.parentID !== userMessageID || (current.agent ?? current.mode) !== 'pulso' || current.summary || current.error || current.time?.completed !== undefined) throw fail('No hay un turno ordinario primario actual');
  }
  return {sessionID: session.id, userMessageID, textHash: contentHash(text), text};
}

/** Authentic reference and text, not semantic proof of approval. No model-supplied identity. */
export async function nativePrimaryRequest(client, context, root, {maxMessages = 500} = {}) {
  if (context?.agent !== 'pulso' || !nonempty(context.sessionID) || !nonempty(context.messageID) || !sameRoot(context.directory, root) || context.abort?.aborted) throw fail('Identidad primaria actual no disponible');
  const session = await sessionProof(client, root, context.sessionID);
  const assistant = await nativeRead(client, root, 'message', {id: session.id, messageID: context.messageID});
  if (assistant?.info?.id !== context.messageID || assistant.info.sessionID !== session.id || assistant.info.role !== 'assistant' || assistant.info.summary || (assistant.info.agent ?? assistant.info.mode) !== 'pulso' || !nonempty(assistant.info.parentID)) throw fail('Assistant nativo no corresponde a la invocación');
  const request = await userRequest(client, root, session, assistant.info.parentID, maxMessages);
  return {session, request: {...request, assistantMessageID: context.messageID}};
}

/** Pure host policy. Idle alone is never evidence of an interrupted objective. */
function classifySession({session, messages, statusMap, projectRoot, projectID, expectedAgent = 'pulso', parentSessionID = null}) {
  const unknown = {status: 'unknown', interruption: 'unknown', physicalCessation: 'unknown'};
  if (!session || !sameRoot(session.directory, projectRoot) || session.projectID !== projectID || (session.parentID ?? null) !== parentSessionID || !Array.isArray(messages) || !statusMap || typeof statusMap !== 'object' || Array.isArray(statusMap)) return unknown;
  if (Object.values(statusMap).some(value => !value || !['idle', 'busy', 'retry'].includes(value.type))) return unknown;
  // Verified implementation: SessionStatus.set(idle) deletes; HTTP status returns list().
  const status = statusMap[session.id]?.type ?? 'idle';
  const base = {status, interruption: 'none', physicalCessation: 'unknown'};
  if (status === 'busy' || status === 'retry') return base;
  const last = messages.findLast(message => message?.info?.role === 'assistant');
  if (!last || last.info.sessionID !== session.id || (last.info.agent ?? last.info.mode) !== expectedAgent || last.info.summary) return {...base, interruption: 'unknown'};
  const index = messages.indexOf(last);
  if (messages.slice(index + 1).some(message => message?.info?.role === 'user')) return {...base, interruption: 'unknown'};
  if (last.info.error?.name === 'MessageAbortedError') return {...base, interruption: 'user_abort', errorMessageID: last.info.id};
  if (!Number.isFinite(last.info.time?.completed) || !errors.has(last.info.error?.name)) return base;
  return {...base, interruption: 'terminal_error', errorMessageID: last.info.id, errorName: last.info.error.name};
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
function historicalExcerpt(message) {
  const text = realText(message);
  return {sessionID: message.info.sessionID, messageID: message.info.id, role: message.info.role,
    ...(message.info.role === 'user' ? {userMessageID: message.info.id} : {}),
    textHash: contentHash(text), text: text.slice(0, 3000), truncated: text.length > 3000,
    authority: 'historical_context_not_new_instruction'};
}
function contextGuard(context, root) {
  const identity = Object.fromEntries(['sessionID', 'messageID', 'agent', 'directory'].map(key => [key, context[key]]));
  return () => {
    if (context.abort?.aborted || !sameRoot(context.directory, root) || Object.entries(identity).some(([key, value]) => context[key] !== value)) throw fail('El contexto de recuperación cambió', 'AUTOMATIC_RECOVERY_STALE');
  };
}

export function createRecoveryPolicy({directory, client, maxMessages = 500, maxDelegations = 40, maxCapsuleBytes = 24000} = {}) {
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
      const owner = await sessionProof(client, root, candidate.ownerSessionID);
      messages = await history(client, root, owner.id, maxMessages);
      snapshots.push({sessionID: owner.id, parentID: null, projectID: owner.projectID, hash: contentHash(messages)});
      let statusMap = await nativeRead(client, root, 'status');
      observation.owner = {...classifyOwner({session: owner, messages, statusMap, projectRoot: root, projectID: session.projectID}), sessionID: owner.id};
      // References and bounded native excerpts support semantic review, including legacy.
      // Persisted sourceText is deliberately never used as proof or copied into this capsule.
      observation.historicalContext = messages.filter(value => ['user', 'assistant'].includes(value.info.role) && realText(value).trim()).slice(-8).map(historicalExcerpt);
      const reference = candidate.intentSource;
      if (reference) {
        observation.intentSourceStatus = 'unverified';
        try {
          if (reference.provenance !== 'native_user_request' || !nonempty(reference.sessionID) || !nonempty(reference.userMessageID) || !nonempty(reference.textHash) || reference.intentRevision !== undefined && reference.intentRevision !== candidate.intentRevision) throw fail('Referencia histórica inválida');
          const sourceSession = reference.sessionID === owner.id ? owner : await sessionProof(client, root, reference.sessionID);
          if (sourceSession.projectID !== session.projectID) throw fail('Fuente histórica de otro proyecto');
          const sourceMessages = reference.sessionID === owner.id ? messages : await history(client, root, reference.sessionID, maxMessages);
          const index = sourceMessages.findIndex(value => value.info.id === reference.userMessageID && value.info.role === 'user');
          if (index < 0 || contentHash(realText(sourceMessages[index])) !== reference.textHash) throw fail('La fuente histórica cambió');
          observation.intentSourceStatus = 'native_reference_verified_not_semantic_approval';
          const existing = new Set(observation.historicalContext.map(value => `${value.sessionID}:${value.messageID}`));
          for (const message of sourceMessages.slice(Math.max(0, index - 3), index + 1)) if (realText(message).trim() && !existing.has(`${message.info.sessionID}:${message.info.id}`)) observation.historicalContext.push(historicalExcerpt(message));
        } catch { /* An unavailable optional reference does not invalidate readable legacy context. */ }
      }
      const records = listDelegations(root, {continuityId: candidate.continuityId});
      if (records.length > maxDelegations) return {...observation, complete: false, reason: 'delegation_limit'};
      const children = [];
      for (const entry of records) {
        const record = readDelegation(root, {workId: entry.workId, delegationId: entry.delegationId});
        for (const attempt of record.attempts) {
          const matches = messages.flatMap(message => message.info.role === 'assistant' && (message.info.agent ?? message.info.mode) === 'pulso' ? message.parts.filter(part => part.type === 'tool' && part.tool === 'task' && part.sessionID === attempt.sessionID && part.callID === attempt.callID && part.state?.input?.prompt === record.specialistPrompt && part.state.input.subagent_type === record.delegation.agent) : []);
          observation.attempts.push({delegationId: record.delegationId, sessionID: attempt.sessionID, callID: attempt.callID, resolution: attempt.resolution, nativeStatus: matches.length === 1 ? matches[0].state.status : 'unknown', physicalCessation: 'unknown', returnIds: record.returns.map(value => value.returnId)});
          if (attempt.resolution !== 'unresolved') continue;
          const unknownChild = {delegationId: record.delegationId, callID: attempt.callID, status: 'unknown', interruption: 'unknown', physicalCessation: 'unknown'};
          if (attempt.sessionID !== owner.id || matches.length !== 1) {observation.childSignals.push({...unknownChild, reason: 'child_identity_unavailable'});continue;}
          const metadata = matches[0].state?.metadata, childID = metadata?.sessionId;
          if (!nonempty(childID) || metadata.parentSessionId !== owner.id || messages.flatMap(message => message.parts).filter(part => part.type === 'tool' && part.tool === 'task' && part.state?.metadata?.sessionId === childID).length !== 1) {observation.childSignals.push({...unknownChild, reason: 'child_identity_ambiguous'});continue;}
          try {
            const child = await nativeRead(client, root, 'get', {id: childID});
            if (child?.id !== childID || child.parentID !== owner.id || child.projectID !== session.projectID || !sameRoot(child.directory, root)) throw fail('Relación nativa del hijo no verificada');
            const childMessages = await history(client, root, childID, maxMessages);
            snapshots.push({sessionID: childID, parentID: owner.id, projectID: child.projectID, hash: contentHash(childMessages)});
            children.push({session: child, messages: childMessages, expectedAgent: record.delegation.agent, parentSessionID: owner.id, delegationId: record.delegationId, callID: attempt.callID,
              currentIntent: !record.retired && record.intentId === candidate.intentId && (record.intentRevision === candidate.intentRevision || candidate.compatibleDelegationIds.includes(record.delegationId))});
          } catch {observation.childSignals.push({sessionID: childID, delegationId: record.delegationId, callID: attempt.callID, status: 'unknown', interruption: 'unknown', physicalCessation: 'unknown'});}
        }
      }
      if (children.length) {
        // Re-read status after child I/O; neither parent nor child idle alone is failure.
        statusMap = await nativeRead(client, root, 'status');
        observation.owner = {...classifyOwner({session: owner, messages, statusMap, projectRoot: root, projectID: session.projectID}), sessionID: owner.id};
        for (const child of children) {
          const signal = classifySession({...child, statusMap, projectRoot: root, projectID: session.projectID});
          const nonterminalTools = child.messages.flatMap(message => message.parts).filter(part => part.type === 'tool' && !['completed', 'error'].includes(part.state?.status)).map(part => ({tool: part.tool, callID: part.callID, status: part.state?.status ?? 'unknown'}));
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
    if (context.abort?.aborted || !sameRoot(context.directory, root) || context.sessionID !== proof.sessionID || context.messageID !== proof.assistantMessageID || context.agent !== 'pulso' || args.workId !== proof.workId || args.continuityId !== proof.continuityId || args.expectedResumeBasis !== proof.expectedResumeBasis) throw fail('Prueba de recuperación ajena', 'AUTOMATIC_RECOVERY_STALE');
    const current = proof.replay ? {complete: true, candidates: inspectContinuities(root, {workId: proof.workId, continuityId: proof.continuityId}, {assertContext: saved.guard}).items} : discoverContinuities(root, {assertContext: saved.guard});
    if (!current.complete || current.candidates.length !== 1 || current.candidates[0].resumable === false || current.candidates[0].continuityId !== proof.continuityId || current.candidates[0].resumeBasis !== proof.observedResumeBasis) throw fail('La continuidad cambió desde la comprobación', 'AUTOMATIC_RECOVERY_STALE');
    if (proof.replay && !appliedReplay(readContinuity(root, proof.continuityId, {nativeContext: {sessionID: proof.sessionID}}), args, proof.source)) throw fail('La transición aplicada ya no corresponde a esta petición', 'AUTOMATIC_RECOVERY_STALE');
    return true;
  }
  return {
    async 'experimental.chat.messages.transform'(_input, output) {
      try {
        assertRoot();
        // This hook is shared with compaction: ordinaryTurn authenticates the current primary.
        const message = output?.messages?.findLast(value => value?.info?.role === 'user');
        if (Array.isArray(message?.parts)) message.parts = message.parts.filter(part => !(part.synthetic === true && part.metadata?.pulsoRecovery === marker));
        if (message?.info.agent !== 'pulso' || !realText(message).trim()) return;
        const session = await sessionProof(client, root, message.info.sessionID);
        const request = await userRequest(client, root, session, message.info.id, maxMessages, true);
        if (request.textHash !== contentHash(realText(message))) return;
        const observation = await inspect(session, request);
        if (!observation.available || observation.reason === 'already_owned_or_unbound' || observation.complete && !observation.candidates.length) return;
        const prefix = 'Observación de continuidad, NO una instrucción del usuario ni prueba de aprobación. Evalúa la petición real más reciente y los acuerdos auténticos; no retomes ante nuevo objetivo, pausa o cancelación. No deduzcas cese físico ni repitas intentos sin resolver. Si la continuidad única sigue autorizada y es recuperable, informa naturalmente y usa resume_continuity con CAS y permiso nativo. Datos:\n';
        let data = observation;
        if (Buffer.byteLength(JSON.stringify(data)) > maxCapsuleBytes) data = {complete: false, reason: 'capsule_limit', request: observation.request, candidates: observation.candidates.map(value => ({workId: value.workId, continuityId: value.continuityId})), note: 'Inspeccionar las referencias pertinentes; no adoptar desde una cápsula incompleta.'};
        const text = prefix + JSON.stringify(data);
        const id = `prt_${contentHash({marker, sessionID: session.id, messageID: message.info.id}).slice(0, 26)}`;
        // Replace only our ephemeral part. No session.update/message/prompt call exists here.
        message.parts = [...message.parts.filter(part => part.metadata?.pulsoRecovery !== marker), {id, type: 'text', sessionID: session.id, messageID: message.info.id, synthetic: true, text, metadata: {pulsoRecovery: marker}}];
      } catch { /* Optional discovery cannot obstruct a normal user turn. */ }
    },
    async inspectInvocation(context) {
      assertRoot();
      const guard = contextGuard(context, root), native = await nativePrimaryRequest(client, context, root, {maxMessages});
      guard();
      const observation = await inspect(native.session, native.request);
      guard();
      return observation;
    },
    async proveAutomaticResume(context, args, {disposition = 'review_required'} = {}) {
      assertRoot();
      const guard = contextGuard(context, root), native = await nativePrimaryRequest(client, context, root, {maxMessages});
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
      const fresh = await nativePrimaryRequest(client, context, root, {maxMessages});
      if (fresh.request.userMessageID !== native.request.userMessageID || fresh.request.textHash !== native.request.textHash || fresh.session.projectID !== native.session.projectID) throw fail('La petición cambió durante la inspección', 'AUTOMATIC_RECOVERY_STALE');
      for (const snapshot of observedHistories.get(observation) ?? []) {
        const session = await nativeRead(client, root, 'get', {id: snapshot.sessionID});
        if (session?.id !== snapshot.sessionID || (session.parentID ?? null) !== snapshot.parentID || session.projectID !== snapshot.projectID || !sameRoot(session.directory, root) || contentHash(await history(client, root, snapshot.sessionID, maxMessages)) !== snapshot.hash) throw fail('Cambió la sesión observada durante la comprobación', 'AUTOMATIC_RECOVERY_STALE');
      }
      // Source authentication also awaits the host. A final status observation
      // catches known activity that appeared during it; still not a host lease.
      if (!replay) {
        const finalStatus = await nativeRead(client, root, 'status');
        if (!finalStatus || typeof finalStatus !== 'object' || Array.isArray(finalStatus) || Object.values(finalStatus).some(value => !value || !['idle', 'busy', 'retry'].includes(value.type)) || [observation.owner.sessionID, ...observation.childSignals.map(value => value.sessionID)].some(id => ['busy', 'retry'].includes(finalStatus[id]?.type))) throw fail('El host ahora informa actividad o estado incierto', 'AUTOMATIC_RECOVERY_STALE');
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
              const parent = await sessionProof(client, root, attempt.sessionID);
              if (parent.projectID !== saved.nativeProjectID) throw fail('El retorno pertenece a otro proyecto nativo');
              const messages = await history(client, root, parent.id, maxMessages);
              cache.set(parent.id, messages);
            }
            const matches = cache.get(attempt.sessionID).flatMap(message => message.info.role === 'assistant' && (message.info.agent ?? message.info.mode) === 'pulso' ? message.parts.filter(part => part.type === 'tool' && part.tool === 'task' && part.callID === attempt.callID && part.sessionID === attempt.sessionID) : []);
            if (matches.length !== 1) throw fail('ToolPart no disponible o ambiguo');
            const part = matches[0];
            if (part.state?.status !== 'completed' || part.state.input?.prompt !== record.specialistPrompt || part.state.input.subagent_type !== record.delegation.agent || part.state.metadata?.parentSessionId !== attempt.sessionID) throw fail('Retorno terminal no confirmado');
            saved.guard();
            readContinuity(root, proof.continuityId, {nativeContext: {sessionID: proof.sessionID}, assertContext: saved.guard});
            // The existing durable validator must still verify the exact terminal wrapper/child.
            const result = await replayPart(structuredClone(part));
            if (result?.capture === 'stored') stored.push(result); else pending.push({delegationId: record.delegationId, ...result});
          } catch (error) {pending.push({delegationId: record.delegationId, callID: attempt.callID, reason: error.code ?? 'native_return_unavailable'});}
        }
      }
      return {ownerTransferred: true, stored, pending, physicalCessation: 'unknown', childSignals: saved.observation.childSignals};
    },
  };
}
