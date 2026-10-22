/** Bounded, read-only discovery in one already selected project. Never prepares it. */
import fs from 'node:fs';
import path from 'node:path';
import {checkContext, contentHash, inspectContinuities, readSidecar} from './continuity.mjs';
import {readWork} from './artifacts.mjs';

const active = new Set(['pending', 'in_progress', 'blocked']);
export function discoverContinuities(root, {assertContext = () => {}, maxRecords = 100, maxWorks = 40} = {}) {
  checkContext({assertContext});
  const metadata = path.join(root, '.pulso');
  if (!fs.existsSync(metadata)) return {available: false, complete: true, candidates: []};
  if (!fs.lstatSync(metadata).isDirectory() || fs.realpathSync(metadata) !== metadata) throw new Error('External metadata tree is not allowed');
  // Partial initialization is not authorization to initialize or repair.
  for (const name of ['project.json', 'state.json']) if (!fs.existsSync(path.join(metadata, name))) return {available: false, complete: false, candidates: [], reason: 'metadata_incomplete'};
  const store = readSidecar(root, 'continuities');
  const ids = [...new Set(store.records.map(record => record.workId))];
  if (store.records.length > maxRecords || ids.length > maxWorks) return {available: true, complete: false, candidates: [], reason: 'discovery_limit'};
  const works = new Map(ids.map(id => [id, readWork(root, id, {files: false})]));
  const candidates = [];
  for (const record of store.records) {
    const work = works.get(record.workId);
    // Inspection validates record identity and schema, including ineligible records.
    const item = inspectContinuities(root, {workId: work.id, continuityId: record.continuityId}, {assertContext}).items[0];
    if (!active.has(work.status) || work.closure || record.cycle !== work.cycle) continue;
    candidates.push({...item, workStatus: work.status, compatibleDelegationIds: [...record.compatibleDelegationIds],
      ...(record.intentSource ? {intentSource: structuredClone(record.intentSource)} : {})});
  }
  checkContext({assertContext});
  // Do not assert uniqueness across an inconsistent read. No lock is acquired.
  if (contentHash(store) !== contentHash(readSidecar(root, 'continuities')) || [...works].some(([id, work]) => contentHash(work) !== contentHash(readWork(root, id, {files: false})))) {
    return {available: true, complete: false, candidates: [], reason: 'discovery_changed'};
  }
  return {available: true, complete: true, projectId: store.projectId, candidates};
}
