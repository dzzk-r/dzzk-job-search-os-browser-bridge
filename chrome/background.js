/* Fixed read operations, explicit per-page grants and loopback companion. */
const grants = new DzzkGrants();
let config = { enabled:false, endpoint:'http://127.0.0.1:43119', token:'' };
let loopRunning = false, generation = 0, status = 'Disconnected', consents = [], clients = [], activeController;
let localPaused = false, serverPaused = false, actions = [];
let policyWrites = Promise.resolve(), pauseIntent = 0;
const isPaused = () => localPaused || serverPaused;
function writePolicy(body) {
  policyWrites = policyWrites.catch(()=>{}).then(()=>companion('/bridge/policy',body));
  return policyWrites;
}
async function clearAccess() {
  const ids = [...grants.tabs.keys()]; grants.clear();
  await Promise.all(ids.map(tabId => chrome.action.setBadgeText({tabId,text:''}).catch(()=>{})));
}
function validateConfig(value) {
  const url = new URL(value.endpoint);
  if (url.origin !== 'http://127.0.0.1:43119' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error('Companion address must be http://127.0.0.1:43119');
  if (!/^[A-Za-z0-9_-]{43}$/.test(value.token)) throw new Error('Paste the 43-character extension pairing token from the companion.');
  return { enabled:Boolean(value.enabled), endpoint:url.origin, token:value.token };
}
async function companion(path, body, cfg = config) {
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
async function hydratedTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (typeof tab.url === 'string' && tab.url) return tab;
  try {
    const result = await chrome.scripting.executeScript({
      target:{tabId},
      func:()=>({url:location.href,title:document.title})
    });
    const page = result[0]?.result;
    if (page?.url) return {...tab,url:page.url,title:page.title || tab.title || ''};
  } catch {}
  return tab;
}
async function readShared(handle, maxChars = 30000) {
  const g = grants.get(handle); grants.check(handle, await hydratedTab(g.tabId));
  const limit = Math.min(Math.max(Number(maxChars) || 30000,1000),60000);
  const result = await chrome.scripting.executeScript({target:{tabId:g.tabId},func:dzzkReadPage,args:[g.url,limit]});
  // Revocation/navigation during a read discards the result.
  grants.check(handle, await hydratedTab(g.tabId));
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
chrome.tabs.onUpdated.addListener((id,change) => {
  if (change.status === 'loading' || change.url) {grants.revoke(id); void chrome.action.setBadgeText({tabId:id,text:''});}
});
chrome.tabs.onRemoved.addListener(id => grants.revoke(id));
chrome.alarms.onAlarm.addListener(() => {grants.list(); void poll();});
chrome.runtime.onMessage.addListener(async (m,sender) => {
  const ui = [chrome.runtime.getURL('popup.html'), chrome.runtime.getURL('options.html'), chrome.runtime.getURL('observer.html')];
  if (sender.id !== chrome.runtime.id || !ui.includes(sender.url)) throw new Error('Only extension UI can change access.');
  switch (m.type) {
    case 'state': return {status,enabled:config.enabled,paused:isPaused(),grants:grants.list(),consents,clients,actions};
    case 'observer-state': {
      if (!config.enabled) throw new Error('Connect the companion before opening the observer.');
      return companion('/bridge/observer');
    }
    case 'configure': {
      const next = validateConfig(m.config);
      if (config.enabled) {try {await companion('/bridge/disconnect',{});} catch {}}
      generation++; activeController?.abort(); await clearAccess(); consents = []; clients = []; actions = []; config = next;
      await chrome.storage.local.set({config}); status = config.enabled ? 'Connecting':'Disconnected'; void poll(); return {ok:true};
    }
    case 'share': {
      if (isPaused()) throw new Error('Browser actions are paused. Resume before sharing a page.');
      if (!config.enabled || status !== 'Connected') throw new Error('Connect the companion before sharing a page.');
      const tab = await hydratedTab(m.tabId);
      if (!tab.active || tab.status === 'loading') throw new Error('Select a fully loaded tab before sharing.');
      const handle = grants.share(tab);
      await chrome.action.setBadgeText({tabId:tab.id,text:'ON'}); await chrome.action.setBadgeBackgroundColor({tabId:tab.id,color:'#176b4b'}); return {handle};
    }
    case 'revoke': {
      const g = grants.get(m.handle); grants.revoke(g.tabId); await chrome.action.setBadgeText({tabId:g.tabId,text:''}); return {ok:true};
    }
    case 'disconnect': {
      config.enabled = false; generation++; activeController?.abort(); await clearAccess(); consents = []; clients = []; actions = []; status = 'Disconnected';
      await chrome.storage.local.set({config}); await chrome.action.setBadgeText({text:''});
      try {await companion('/bridge/disconnect',{});} catch {} return {ok:true};
    }
    case 'consent': return companion('/bridge/consent',{id:m.id,allow:m.allow === true});
    case 'revoke-client': return companion('/bridge/revoke-client',{id:m.id});
    case 'set-policy': {
      if (typeof m.paused === 'boolean') {
        const intent = ++pauseIntent;
        if (m.paused) {
          localPaused = true; status = 'Paused'; actions = []; await clearAccess();
          await chrome.storage.local.set({localPaused});
        }
        const result = await writePolicy({paused:m.paused});
        // A failed resume keeps the local prohibition in force.
        if (intent !== pauseIntent) return result;
        if (!m.paused) {
          localPaused = false; serverPaused = false;
          await chrome.storage.local.set({localPaused}); status = config.enabled ? 'Connected' : 'Disconnected';
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
chrome.runtime.onInstalled.addListener(() => {void chrome.runtime.openOptionsPage();});
void (async () => {
  const saved = await chrome.storage.local.get(['config','localPaused']); localPaused = saved.localPaused === true;
  if (saved.config) {try {config = validateConfig(saved.config);} catch {}}
  await chrome.alarms.create('connection',{periodInMinutes:0.5}); void poll();
})();
