/* Fixed read operations, explicit per-page grants and loopback companion. */
const grants = new DzzkGrants();
let conversations = new DzzkConversationBindings();
let config = { enabled:false, endpoint:'http://127.0.0.1:43119', token:'' };
let loopRunning = false, generation = 0, status = 'Disconnected', consents = [], clients = [], activeController;
let localPaused = false, serverPaused = false, actions = [];
let publishedConversationSignature = null, publishedConversationAt = 0;
let policyWrites = Promise.resolve(), pauseIntent = 0;
const isPaused = () => localPaused || serverPaused;
async function persistConversationBindings() { const api=globalThis.chrome || globalThis.browser; await api.storage.local.set({conversationBindings:conversations.serialize()}); }
function writePolicy(body) {
  policyWrites = policyWrites.catch(()=>{}).then(()=>companion('/bridge/policy',body));
  return policyWrites;
}
async function clearAccess() {
  const ids = [...grants.tabs.keys()]; grants.clear();
  await Promise.all(ids.map(tabId => browser.action.setBadgeText({tabId,text:''}).catch(()=>{})));
}
function validateConfig(value) {
  const url = new URL(value.endpoint);
  const port=Number(url.port || (url.protocol==='http:'?80:0));
  if (url.protocol!=='http:' || url.hostname!=='127.0.0.1' || url.pathname!=='/' || url.search || url.hash || url.username || url.password || !Number.isInteger(port) || port<1 || port>65535) throw new Error('Companion address must be loopback HTTP, for example http://127.0.0.1:43119');
  if (!/^[A-Za-z0-9_-]{43}$/.test(value.token)) throw new Error('Paste the 43-character extension pairing token from the companion.');
  return { enabled:Boolean(value.enabled), endpoint:url.origin, token:value.token };
}
async function companion(path, body, cfg = config) {
  const adapter = 'firefox';
  if (path.startsWith('/bridge/')) path += '?adapter=' + adapter;
  const controller = new AbortController(); activeController = controller;
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(cfg.endpoint + path, {
      method:body === undefined ? 'GET':'POST', cache:'no-store', credentials:'omit',
      headers:{ Authorization:`Bearer ${cfg.token}`, ...(body === undefined ? {} : {'Content-Type':'application/json'}) },
      ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:controller.signal
    });
    if (!response.ok) throw new Error('Companion refused the request. Check pairing and server status.');
    return await response.json();
  } finally { clearTimeout(timer); }
}
async function currentConversationBinding() {
  const api=globalThis.chrome || globalThis.browser;
  const tabs=await api.tabs.query({active:true,lastFocusedWindow:true});
  const raw=(tabs||[]).find(t=>t && typeof t.id==='number')||null;
  if(!raw) return null;
  const tab=typeof raw.url==='string'&&raw.url ? raw : await hydratedTab(raw.id);
  const existing=conversations.getByTab(tab);
  if(existing) return existing;
  try {
    const binding=conversations.bind(tab);
    await persistConversationBindings();
    return binding;
  } catch {
    return null;
  }
}
async function publishActiveConversation() {
  const binding=await currentConversationBinding();
  const value=binding ? {
    conversation_id:binding.conversation_id,
    url:binding.url,
    title:binding.title||'',
    source_quality:'browser_observed',
    observed_at:new Date().toISOString()
  } : null;
  const signature=value ? value.conversation_id+'|'+value.url : 'null';
  const now=Date.now();
  if(signature===publishedConversationSignature && (signature==='null' || now-publishedConversationAt<5000)) return;
  await companion('/bridge/conversation-active',{binding:value});
  publishedConversationSignature=signature;
  publishedConversationAt=now;
}
async function conversationTab(tabId) {
  const api=globalThis.chrome || globalThis.browser;
  return api.tabs.get(tabId);
}
async function readShared(handle, maxChars = 30000) {
  const g = grants.get(handle); grants.check(handle, await browser.tabs.get(g.tabId));
  const limit = Math.min(Math.max(Number(maxChars) || 30000,1000),60000);
  const result = await browser.scripting.executeScript({target:{tabId:g.tabId},func:dzzkReadPage,args:[g.url,limit]});
  // Revocation/navigation during a read discards the result.
  grants.check(handle, await browser.tabs.get(g.tabId));
  if (result[0]?.error || !result[0]?.result) throw new Error('Page could not be read. Share a regular webpage again.');
  return {...result[0].result, handle};
}
async function runCommand(command) {
  if (!config.enabled) throw new Error('Browser bridge is disconnected.');
  if (isPaused()) throw new Error('Browser actions are paused by the user.');
  const a = command.args || {};
  switch (command.method) {
    case 'tabs.list': return {tabs:grants.list()};
    case 'page.read': return readShared(a.handle,a.maxChars);
    case 'page.find': {
      if (typeof a.query !== 'string' || !a.query.trim() || a.query.length > 200) throw new Error('Query must contain 1–200 characters.');
      const page = await readShared(a.handle,60000), matches = [];
      const hay = page.text.toLocaleLowerCase(), query = a.query.toLocaleLowerCase();
      for (let at = hay.indexOf(query); at !== -1 && matches.length < 20; at = hay.indexOf(query,at+query.length)) matches.push({offset:at,excerpt:page.text.slice(Math.max(0,at-160),at+query.length+240)});
      const {text,...metadata} = page; return {...metadata,matches,searchedChars:text.length};
    }
    case 'bridge.status': return {connected:true,sharedTabs:grants.list().length,mode:'read-only'};
    default: throw new Error('Unsupported operation. This version only reads shared pages.');
  }
}
async function poll() {
  if (loopRunning || !config.enabled) return;
  loopRunning = true; const epoch = generation;
  try {
    while (config.enabled && epoch === generation) {
      try {
        await publishActiveConversation();
        const batch = await companion('/bridge/next');
        if (!config.enabled || epoch !== generation) break;
        consents = batch.consents || []; clients = batch.clients || []; actions = batch.actions || [];
        serverPaused = batch.policy?.paused === true;
        if (isPaused()) await clearAccess();
        status = isPaused() ? 'Paused' : 'Connected';
        for (const command of batch.commands || []) {
          let response;
          try { response = {id:command.id,result:await runCommand(command)}; } catch(e) { response = {id:command.id,error:e.message}; }
          if (config.enabled && epoch === generation) {
            if (isPaused()) response = {id:command.id,error:'Browser actions are paused by the user.'};
            await companion('/bridge/result',response);
          }
        }
      } catch { status = 'Companion unavailable'; consents = []; clients = []; actions = []; }
      await new Promise(resolve => setTimeout(resolve,1000));
    }
  } finally { loopRunning = false; if (config.enabled) void poll(); }
}
browser.tabs.onUpdated.addListener((id,change) => {
  if (change.status === 'loading' || change.url) {
    grants.revoke(id);
    if (conversations.revoke(id)) void persistConversationBindings();
    publishedConversationSignature=null; publishedConversationAt=0;
    void browser.action.setBadgeText({tabId:id,text:''});
  }
});
browser.tabs.onRemoved.addListener(id => {
  grants.revoke(id);
  if (conversations.revoke(id)) void persistConversationBindings();
});
browser.alarms.onAlarm.addListener(() => {grants.list(); void poll();});
browser.runtime.onMessage.addListener(async (m,sender) => {
  const ui = [browser.runtime.getURL('popup.html'), browser.runtime.getURL('options.html'), browser.runtime.getURL('observer.html')];
  if (sender.id !== browser.runtime.id || !ui.includes(sender.url)) throw new Error('Only extension UI can change access.');
  switch (m.type) {
    case 'state': return {status,enabled:config.enabled,endpoint:config.endpoint,paused:isPaused(),grants:grants.list(),consents,clients,actions};
    case 'conversation-state': return {bindings:conversations.list()};
    case 'conversation-current': return {binding:await currentConversationBinding()};
    case 'conversation-bind': {
      const tab=await conversationTab(m.tabId);
      if (!tab.active || tab.status === 'loading') throw new Error('Select a fully loaded ChatGPT tab before binding.');
      const binding=conversations.bind(tab);
      await persistConversationBindings();
      return {binding};
    }
    case 'conversation-unbind': {
      const changed=conversations.revoke(m.tabId);
      if (changed) await persistConversationBindings();
      return {ok:true};
    }
    case 'observer-state': {
      if (!config.enabled) throw new Error('Connect the companion before opening the observer.');
      return companion('/bridge/observer');
    }
    case 'configure': {
      const next = validateConfig(m.config);
      if (config.enabled) {try {await companion('/bridge/disconnect',{});} catch {}}
      generation++; activeController?.abort(); await clearAccess(); consents = []; clients = []; actions = []; config = next;
      await browser.storage.local.set({config}); status = config.enabled ? 'Connecting':'Disconnected'; void poll(); return {ok:true};
    }
    case 'share': {
      if (isPaused()) throw new Error('Browser actions are paused. Resume before sharing a page.');
      if (!config.enabled || status !== 'Connected') throw new Error('Connect the companion before sharing a page.');
      const tab = await browser.tabs.get(m.tabId);
      if (!tab.active || tab.status === 'loading') throw new Error('Select a fully loaded tab before sharing.');
      const handle = grants.share(tab);
      await browser.action.setBadgeText({tabId:tab.id,text:'ON'}); await browser.action.setBadgeBackgroundColor({tabId:tab.id,color:'#176b4b'}); return {handle};
    }
    case 'revoke': {
      const g = grants.get(m.handle); grants.revoke(g.tabId); await browser.action.setBadgeText({tabId:g.tabId,text:''}); return {ok:true};
    }
    case 'disconnect': {
      config.enabled = false; generation++; activeController?.abort(); await clearAccess(); consents = []; clients = []; actions = []; status = 'Disconnected';
      await browser.storage.local.set({config}); await browser.action.setBadgeText({text:''});
      try {await companion('/bridge/disconnect',{});} catch {} return {ok:true};
    }
    case 'consent': return companion('/bridge/consent',{id:m.id,allow:m.allow === true});
    case 'revoke-client': return companion('/bridge/revoke-client',{id:m.id});
    case 'set-policy': {
      if (typeof m.paused === 'boolean') {
        const intent = ++pauseIntent;
        if (m.paused) {
          localPaused = true; status = 'Paused'; actions = []; await clearAccess();
          await browser.storage.local.set({localPaused});
        }
        const result = await writePolicy({paused:m.paused});
        // A failed resume keeps the local prohibition in force.
        if (intent !== pauseIntent) return result;
        if (!m.paused) {
          localPaused = false; serverPaused = false;
          await browser.storage.local.set({localPaused}); status = config.enabled ? 'Connected' : 'Disconnected';
        } else serverPaused = true;
        return result;
      }
      if (!['tabs.list','page.read','page.find','bridge.status','local.status','local.list_dir','local.read_file','local.write_file','local.exec_start','local.process_output','local.process_stop'].includes(m.method) || !['allow','ask','block'].includes(m.mode) || typeof m.clientId !== 'string') throw new Error('Invalid permission setting.');
      return writePolicy({clientId:m.clientId,method:m.method,mode:m.mode});
    }
    case 'action-consent': return companion('/bridge/action-consent',{id:m.id,allow:m.allow === true});
    default: throw new Error('Unknown UI action.');
  }
});
browser.runtime.onInstalled.addListener(() => {void browser.runtime.openOptionsPage();});
void (async () => {
  const saved = await browser.storage.local.get(['config','localPaused','conversationBindings']); localPaused = saved.localPaused === true;
  conversations = new DzzkConversationBindings(saved.conversationBindings || []);
  if (saved.config) {try {config = validateConfig(saved.config);} catch {}}
  await browser.alarms.create('connection',{periodInMinutes:0.5}); void poll();
})();
