/* Fixed read operations, explicit per-page grants and loopback companion. */
const grants = new DzzkGrants();
let config = { enabled:false, endpoint:'http://127.0.0.1:43119', token:'' };
let loopRunning = false, generation = 0, status = 'Disconnected', consents = [], clients = [], activeController;
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
        consents = batch.consents || []; clients = batch.clients || []; status = 'Connected';
        for (const command of batch.commands || []) {
          let response;
          try { response = {id:command.id,result:await runCommand(command)}; } catch(e) { response = {id:command.id,error:e.message}; }
          if (config.enabled && epoch === generation) await companion('/bridge/result',response);
        }
      } catch { status = 'Companion unavailable'; consents = []; clients = []; }
      await new Promise(resolve => setTimeout(resolve,1000));
    }
  } finally { loopRunning = false; if (config.enabled) void poll(); }
}
browser.tabs.onUpdated.addListener((id,change) => {
  if (change.status === 'loading' || change.url) {grants.revoke(id); void browser.action.setBadgeText({tabId:id,text:''});}
});
browser.tabs.onRemoved.addListener(id => grants.revoke(id));
browser.alarms.onAlarm.addListener(() => {grants.list(); void poll();});
browser.runtime.onMessage.addListener(async (m,sender) => {
  const ui = [browser.runtime.getURL('popup.html'), browser.runtime.getURL('options.html')];
  if (sender.id !== browser.runtime.id || !ui.includes(sender.url)) throw new Error('Only extension UI can change access.');
  switch (m.type) {
    case 'state': return {status,enabled:config.enabled,grants:grants.list(),consents,clients};
    case 'configure': {
      const next = validateConfig(m.config);
      if (config.enabled) {try {await companion('/bridge/disconnect',{});} catch {}}
      generation++; activeController?.abort(); grants.clear(); consents = []; clients = []; config = next;
      await browser.storage.local.set({config}); status = config.enabled ? 'Connecting':'Disconnected'; void poll(); return {ok:true};
    }
    case 'share': {
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
      config.enabled = false; generation++; activeController?.abort(); grants.clear(); consents = []; clients = []; status = 'Disconnected';
      await browser.storage.local.set({config}); await browser.action.setBadgeText({text:''});
      try {await companion('/bridge/disconnect',{});} catch {} return {ok:true};
    }
    case 'consent': return companion('/bridge/consent',{id:m.id,allow:m.allow === true});
    case 'revoke-client': return companion('/bridge/revoke-client',{id:m.id});
    default: throw new Error('Unknown UI action.');
  }
});
browser.runtime.onInstalled.addListener(() => {void browser.runtime.openOptionsPage();});
void (async () => {
  const saved = await browser.storage.local.get('config'); if (saved.config) {try {config = validateConfig(saved.config);} catch {}}
  await browser.alarms.create('connection',{periodInMinutes:0.5}); void poll();
})();
