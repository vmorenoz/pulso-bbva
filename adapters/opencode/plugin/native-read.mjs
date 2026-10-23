/** OpenCode 2.1.2 read-only transport. Complete history is NEVER session.context.
 * Official Promise client + bounded read-only registration; no server start or mutation.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const fail = message => Object.assign(new Error(message), {code:'NATIVE_AUTHORITY_UNAVAILABLE'});
const text = value => typeof value === 'string' && value.trim().length > 0;
const root = value => { try { return fs.realpathSync(value); } catch { throw fail('Native session directory unavailable'); } };
function identity(session) {
  if (!text(session?.id) || !text(session.projectID) || !text(session.location?.directory)) throw fail('Incomplete native session identity');
  return JSON.stringify([session.id,session.projectID,root(session.location.directory),session.parentID ?? null,session.agent ?? null]);
}
function localURL(value) {
  let url; try { url = new URL(value); } catch { throw fail('Invalid configured native service URL'); }
  if (!['http:','https:'].includes(url.protocol) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw fail('Native service URL must be an explicit local origin without credentials');
  return url.href;
}

export async function createNativeReader(ctx, {client} = {}) {
  let resolved = client;
  const live = new Map();
  function observe(event) {
    const data = event?.data;
    if (!text(data?.sessionID)) return;
    if (event.type === 'session.moved') {for (const [key,value] of live) if (value.sessionID === data.sessionID) live.delete(key);return;}
    if (!text(data.assistantMessageID) || !text(data.id)) return;
    const key = JSON.stringify([data.sessionID,data.assistantMessageID,data.id]);
    if (['session.tool.success','session.tool.failed'].includes(event.type)) {live.delete(key);return;}
    if (event.type !== 'session.tool.progress' || data.metadata?.status !== 'running' || !text(data.metadata.sessionID)) return;
    live.set(key,{sessionID:data.sessionID,metadata:{sessionID:data.metadata.sessionID,status:'running'}});
    while(live.size > 256) live.delete(live.keys().next().value);
  }
  async function transport() {
    if (resolved) return resolved;
    if (!['cli','opencode'].includes(ctx.app?.name) || ctx.app.version !== '2.1.2') throw fail('Unsupported native host; OpenCode 2.1.2 is required');
    const {OpenCode} = await import('./vendor/client/promise/index.js');
    // Operator configuration and host-owned registration are never tool inputs.
    let endpoint, registration;
    if (ctx.options?.serviceUrl) {
      if (ctx.options.servicePassword !== undefined && !text(ctx.options.servicePassword)) throw fail('Configured native service password must be nonempty');
      endpoint = {url:localURL(ctx.options.serviceUrl),...(ctx.options.servicePassword ? {auth:{type:'basic',username:'opencode',password:ctx.options.servicePassword}} : {})};
    } else {
      const file = ctx.app.serviceFile ?? path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(),'.local','state'),'opencode','service.json');
      if (!path.isAbsolute(file)) throw fail('Native service registration must be absolute');
      // Validate before *any* probe/authentication. The official discover helper
      // probes a registration before returning its URL, so cannot enforce this.
      let descriptor;
      try {
        descriptor = fs.openSync(file,fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        const info = fs.fstatSync(descriptor);
        if (!info.isFile() || info.size > 65536) throw fail('Unsafe native service registration');
        const buffer = Buffer.alloc(65537), size = fs.readSync(descriptor,buffer,0,buffer.length,0);
        if (size > 65536) throw fail('Unsafe native service registration');
        registration = JSON.parse(buffer.subarray(0,size).toString('utf8'));
      } catch {throw fail('Invalid or unavailable native service registration');}
      finally {if (descriptor !== undefined) fs.closeSync(descriptor);}
      if (!text(registration?.id) || registration.version !== '2.1.2' || !Number.isInteger(registration.pid) || registration.pid <= 0 || (registration.password !== undefined && !text(registration.password))) throw fail('Incomplete native service registration');
      endpoint = {url:localURL(registration.url),...(registration.password ? {auth:{type:'basic',username:'opencode',password:registration.password}} : {})};
    }
    if (!endpoint) throw fail('Full native replay requires the existing compatible service or configured local serviceUrl');
    localURL(endpoint.url);
    const value = OpenCode.make({baseUrl:endpoint.url,fetch:(input,init)=>fetch(input,{...init,redirect:'error'}),headers:endpoint.auth ? {authorization:'Basic '+Buffer.from(`${endpoint.auth.username}:${endpoint.auth.password}`).toString('base64')} : undefined});
    const info = await value.server.info({signal:AbortSignal.timeout(5000)});
    if (info?.version !== '2.1.2') throw fail('Native replay service version does not match OpenCode 2.1.2');
    if (registration && info.pid !== registration.pid) throw fail('Native service PID does not match its registration');
    resolved = value;
    return resolved;
  }
  async function getSession(sessionID) {
    if (!text(sessionID) || typeof ctx.session?.get !== 'function') throw fail('Native session API unavailable');
    const session = await ctx.session.get({sessionID});
    identity(session);
    if (session.id !== sessionID) throw fail('Native session ID mismatch');
    return session;
  }
  async function bound(sessionID) {
    const native = await getSession(sessionID), value = await transport();
    const remote = await value.session.get({sessionID},{signal:AbortSignal.timeout(5000)});
    if (identity(native) !== identity(remote)) throw fail('Native replay service does not match the invoking host session');
    return {value,identity:identity(native)};
  }
  async function history(sessionID, {maxMessages = 500,includeLive = false} = {}) {
    if (!Number.isInteger(maxMessages) || maxMessages < 1) throw fail('Invalid native history bound');
    const binding = await bound(sessionID), {value} = binding, result = [], ids = new Set(), cursors = new Set();
    let cursor;
    do {
      const page = await value.message.list({sessionID,limit:Math.min(200,maxMessages-result.length+1),...(cursor ? {cursor} : {order:'asc'})},{signal:AbortSignal.timeout(5000)});
      if (!Array.isArray(page?.data) || !page.cursor || typeof page.cursor !== 'object') throw fail('Incomplete native history page');
      for (const message of page.data) {
        if (!text(message?.id) || !text(message.type) || ids.has(message.id)) throw fail('Ambiguous native history');
        ids.add(message.id);result.push(message);
      }
      if (result.length > maxMessages) throw fail('Historial nativo fuera del límite');
      cursor = page.cursor.next;
      if (cursor != null && (!text(cursor) || cursors.has(cursor) || !page.data.length)) throw fail('Invalid native history cursor');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    if ((await bound(sessionID)).identity !== binding.identity) throw fail('Native session moved or rebound during history read');
    if (!includeLive) return result;
    // Running progress is explicitly ephemeral in V2. Overlay only for current
    // child authority, never for restart replay or terminal capture. Persisted
    // parent call + independently verified session ancestry remain mandatory.
    return result.map(message => message.type !== 'assistant' ? message : {...message,content:message.content.map(part => {
      if (part.type !== 'tool' || part.name !== 'subagent' || part.state?.status !== 'running') return part;
      const progress = live.get(JSON.stringify([sessionID,message.id,part.id]));
      if (!progress) return part;
      if (part.state.metadata?.sessionID && part.state.metadata.sessionID !== progress.metadata.sessionID) throw fail('Conflicting native live child identity');
      return {...part,state:{...part.state,metadata:{...part.state.metadata,...progress.metadata}}};
    })});
  }
  async function getMessage(sessionID, messageID) {
    const binding = await bound(sessionID), {value} = binding;
    const message = await value.session.message.get({sessionID,messageID},{signal:AbortSignal.timeout(5000)});
    if (message?.id !== messageID || !text(message.type)) throw fail('Native message identity mismatch');
    if ((await bound(sessionID)).identity !== binding.identity) throw fail('Native session moved or rebound during message read');
    return message;
  }
  async function status() {
    const value = await transport(), active = await value.session.active({signal:AbortSignal.timeout(5000)});
    if (!active || typeof active !== 'object' || Array.isArray(active) || Object.values(active).some(item => item?.type !== 'running')) throw fail('Unknown native activity response');
    return active;
  }
  return Object.freeze({getSession,history,getMessage,status,observe});
}
