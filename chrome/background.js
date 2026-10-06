/* Fixed read operations, explicit per-page grants and loopback companion. */
const grants = new DzzkGrants();
let conversations = new DzzkConversationBindings();
let config = { enabled:false, endpoint:'http://127.0.0.1:43119', token:'' };
let loopRunning = false, generation = 0, status = 'Disconnected', consents = [], clients = [], activeController;
let localPaused = false, serverPaused = false, actions = [];
let seenReloadRevision = 0, pendingReloadRevision = 0;
let publishedConversationSignature = null, publishedConversationAt = 0;
const chatDetectorByTab = new Map();
let policyWrites = Promise.resolve(), pauseIntent = 0;
const isPaused = () => localPaused || serverPaused;
async function persistConversationBindings() { const api=globalThis.chrome || globalThis.browser; await api.storage.local.set({conversationBindings:conversations.serialize()}); }
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
  const adapter = 'chrome';
  if (path.startsWith('/bridge/')) path += '?adapter=' + adapter;
  const controller = new AbortController(); activeController = controller;
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(cfg.endpoint + path, {
      method:body === undefined ? 'GET':'POST', cache:'no-store', credentials:'omit',
      headers:{ Authorization:`Bearer ${cfg.token}`, ...(body === undefined ? {} : {'Content-Type':'application/json'}) },
      ...(body === undefined ? {} : {body:JSON.stringify(body)}), signal:controller.signal
    });
    if (!response.ok) {
      let detail='';
      try {
        const payload=await response.json();
        detail=payload?.error_description||payload?.error||'';
      } catch {}
      if (response.status===503 && detail==='observer_unavailable') throw new Error('observer_unavailable: Observer snapshot is unavailable.');
      if (response.status===401) throw new Error('invalid_pairing: Companion rejected the extension pairing token.');
      throw new Error('companion_http_'+response.status+(detail?': '+detail:''));
    }
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


let lastChatInventoryAt = 0;
async function publishChatTabInventory(force=false) {
  const now=Date.now();
  if(!force && now-lastChatInventoryAt<30000) return;
  lastChatInventoryAt=now;
  const tabs=await chrome.tabs.query({url:['https://chatgpt.com/*','https://*.chatgpt.com/*']});
  const inventory=(tabs||[]).filter(t=>Number.isInteger(t?.id)).map(t=>({
    tab_id:t.id,
    url:t.url||'',
    title:t.title||'',
    status:t.status||null,
    discarded:t.discarded===true,
    active:t.active===true,
    window_id:Number.isInteger(t.windowId)?t.windowId:null
  }));
  try { await companion('/bridge/chat-tab-inventory',{tabs:inventory,observed_at:new Date().toISOString()}); } catch {}
}
async function ensureChatContext(tabId) {
  if(!Number.isInteger(tabId)) return false;
  let tab;
  try { tab=await chrome.tabs.get(tabId); } catch { return false; }
  if(!tab || tab.discarded===true || tab.status==='loading') return false;
  let url;
  try { url=new URL(tab.url||''); } catch { return false; }
  if(url.protocol!=='https:' || !(url.hostname==='chatgpt.com'||url.hostname.endsWith('.chatgpt.com'))) return false;
  try {
    await chrome.scripting.executeScript({target:{tabId},files:['chat-context.js']});
    return true;
  } catch { return false; }
}
async function discoverExistingChatTabs() {
  const tabs=await chrome.tabs.query({active:true});
  for(const tab of tabs||[]) await ensureChatContext(tab?.id);
}
async function poll() {
  if (loopRunning || !config.enabled) return;
  loopRunning = true; const epoch = generation;
  try {
    while (config.enabled && epoch === generation) {
      try {
        await publishActiveConversation();
        await publishChatTabInventory();
        const batch = await companion('/bridge/next');
        if (!config.enabled || epoch !== generation) break;
        const reloadRevision=Number(batch.reload_revision)||0;
        if(reloadRevision>seenReloadRevision) pendingReloadRevision=reloadRevision;
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
  if (change.status === 'loading' || change.url) {
    grants.revoke(id);
    if (conversations.revoke(id)) void persistConversationBindings();
    publishedConversationSignature=null; publishedConversationAt=0;
    chatDetectorByTab.delete(id);
    void chrome.action.setBadgeText({tabId:id,text:''});
  }
  if(change.status==='complete' || change.url) void ensureChatContext(id);
});
chrome.tabs.onRemoved.addListener(id => {
  chatDetectorByTab.delete(id);
  grants.revoke(id);
  if (conversations.revoke(id)) void persistConversationBindings();
  publishedConversationSignature=null; publishedConversationAt=0;
});
chrome.tabs.onActivated.addListener(({tabId}) => {
  publishedConversationSignature=null; publishedConversationAt=0;
  void ensureChatContext(tabId);
  void publishChatTabInventory(true);
});
chrome.alarms.onAlarm.addListener(() => {grants.list(); void poll();});
chrome.runtime.onMessage.addListener(async (m,sender) => {
  const uiPaths = new Set(['/popup.html','/options.html','/observer.html']);
  let trustedUi=false;
  try {
    const u=new URL(sender.url||'');
    trustedUi=sender.id===chrome.runtime.id && u.origin===new URL(chrome.runtime.getURL('/')).origin && uiPaths.has(u.pathname);
  } catch {}
  const isChatObservation = ['chat-context-observed','chat-turn-observed','chat-detector-status'].includes(m?.type) && sender.id===chrome.runtime.id && sender.tab;
  if (!isChatObservation && !trustedUi) throw new Error('Only extension UI can change access.');
  switch (m.type) {
    case 'state': return {status,enabled:config.enabled,paused:isPaused(),grants:grants.list(),consents,clients,actions,pendingReloadRevision,loadedVersion:chrome.runtime.getManifest().version};
    case 'chat-context-observed': {
      const tab=sender.tab;
      if(!tab || !Number.isInteger(tab.id)) throw new Error('Chat context observation requires a browser tab.');
      if(m.conversation_id===null) {
        const changed=conversations.revoke(tab.id);
        if(changed) await persistConversationBindings();
        return {ok:true,binding:null};
      }
      const observedTab={...tab,url:m.url||tab.url,title:m.title||tab.title||'',status:'complete'};
      const previous=conversations.getByTab(observedTab);
      const binding=conversations.bind(observedTab);
      await persistConversationBindings();
      if(!previous || previous.conversation_id!==binding.conversation_id || previous.url!==binding.url || previous.title!==binding.title) {
        try {
          await companion('/bridge/chat-observed',{
            conversation_id:binding.conversation_id,
            url:binding.url,
            title:binding.title||'',
            tab_id:binding.tabId,
            observed_at:m.observed_at||new Date().toISOString()
          });
        } catch {}
      }
      return {ok:true,binding};
    }
    case 'chat-detector-status': {
      if(m.detector_version!=='turn-v3') return {ok:true,ignored:true};
      const tab=sender.tab;
      if(!tab || !Number.isInteger(tab.id)) throw new Error('Chat detector status requires a browser tab.');
      const localActivity={
        detector_version:m.detector_version,
        conversation_id:m.conversation_id,
        observed_at:m.observed_at||new Date().toISOString(),
        generating:m.generating===true,
        active_turn_id:m.active_turn_id||null
      };
      chatDetectorByTab.set(tab.id,localActivity);
      try {
        await companion('/bridge/chat-detector-status',{
          detector_version:m.detector_version,
          conversation_id:m.conversation_id,
          url:m.url||tab.url,
          title:m.title||tab.title||'',
          observed_at:localActivity.observed_at,
          user_count:m.user_count,
          assistant_count:m.assistant_count,
          generating:localActivity.generating,
          active_turn_id:localActivity.active_turn_id,
          structural_counts:m.structural_counts&&typeof m.structural_counts==='object'?m.structural_counts:null,
          tab_id:tab.id
        });
      } catch {}
      return {ok:true,local:true};
    }
    case 'chat-turn-observed': {
      if(m.detector_version!=='turn-v3') return {ok:true,ignored:true};
      const tab=sender.tab;
      if(!tab || !Number.isInteger(tab.id)) throw new Error('Chat turn observation requires a browser tab.');
      const binding=conversations.getByTab({...tab,url:m.url||tab.url,title:m.title||tab.title||''});
      if(!binding || binding.conversation_id!==m.conversation_id) throw new Error('Chat turn does not match the tab conversation binding.');
      return companion('/bridge/turn-observed',{
        phase:m.phase,
        conversation_id:m.conversation_id,
        turn_id:m.turn_id,
        url:m.url||binding.url,
        title:m.title||binding.title||'',
        observed_at:m.observed_at,
        reason:m.reason||null,
        user_count:Number.isInteger(m.user_count)?m.user_count:null,
        assistant_count:Number.isInteger(m.assistant_count)?m.assistant_count:null
      });
    }
    case 'conversation-state': return {bindings:conversations.list()};

    case 'conversation-open': {
      const id=String(m.conversation_id||'');
      if(!/^[A-Za-z0-9_-]{6,160}$/.test(id)) throw new Error('Invalid conversation id.');
      let binding=conversations.list().find(x=>x.conversation_id===id)||null;
      const candidates=await chrome.tabs.query({url:['https://chatgpt.com/*','https://*.chatgpt.com/*']});
      let tab=null;
      for(const candidate of candidates||[]) {
        try {
          if(DzzkConversationBindings.conversationId({...candidate,status:'complete'})===id) { tab=candidate; break; }
        } catch {}
      }
      if(!tab && binding?.tabId!=null) {
        try {
          const candidate=await chrome.tabs.get(binding.tabId);
          if(DzzkConversationBindings.conversationId({...candidate,status:'complete'})===id) tab=candidate;
        } catch {}
      }
      if(tab) {
        try { binding=conversations.bind({...tab,status:'complete'}); await persistConversationBindings(); } catch {}
        await chrome.tabs.update(tab.id,{active:true});
        if(Number.isInteger(tab.windowId) && chrome.windows?.update) await chrome.windows.update(tab.windowId,{focused:true});
        return {ok:true,opened:'existing',tab_id:tab.id};
      }
      if(!binding?.url) throw new Error('Source chat is no longer available.');
      const synthetic={id:-1,url:binding.url,title:binding.title||'',status:'complete',incognito:false};
      if(DzzkConversationBindings.conversationId(synthetic)!==id) throw new Error('Stored source chat URL does not match the conversation.');
      const created=await chrome.tabs.create({url:binding.url,active:true});
      return {ok:true,opened:'new',tab_id:created?.id??null};
    }

    case 'conversation-current': {
      const binding=await currentConversationBinding();
      const activity=binding?.tabId!=null ? chatDetectorByTab.get(binding.tabId)||null : null;
      const fresh=activity && Date.now()-Date.parse(activity.observed_at||0)<=15000 ? activity : null;
      return {binding,activity:fresh ? {
        conversation_id:fresh.conversation_id,
        turn_id:fresh.active_turn_id,
        active:Boolean(fresh.generating||fresh.active_turn_id),
        generating:fresh.generating===true,
        source_quality:'browser_observed'
      } : null};
    }
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
    case 'reload-extension': {
      const revision=pendingReloadRevision||seenReloadRevision;
      seenReloadRevision=Math.max(seenReloadRevision,revision);
      pendingReloadRevision=0;
      await chrome.storage.local.set({seenReloadRevision});
      setTimeout(()=>chrome.runtime.reload(),50);
      return {ok:true,version:chrome.runtime.getManifest().version};
    }
    case 'observer-state': {
      if (!config.enabled) throw new Error('Connect the companion before opening the observer.');
      return companion('/bridge/observer');
    }
    case 'dispatch-state': {
      if (!config.enabled) throw new Error('Connect the companion before checking prepared dispatch.');
      return companion('/bridge/dispatch-state');
    }
    case 'dispatch-prepared': {
      if (!config.enabled) throw new Error('Connect the companion before dispatching prepared work.');
      return companion('/bridge/dispatch-prepared',{});
    }
    case 'gw01-acceptance': {
      if (!config.enabled) throw new Error('Connect the companion before running GW-01 acceptance.');
      return companion('/bridge/gw01-acceptance',{});
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
  const saved = await chrome.storage.local.get(['config','localPaused','conversationBindings','seenReloadRevision']); localPaused = saved.localPaused === true;
  seenReloadRevision = Number(saved.seenReloadRevision)||0;
  conversations = new DzzkConversationBindings(saved.conversationBindings || []);
  if (saved.config) {try {config = validateConfig(saved.config);} catch {}}
  await chrome.alarms.create('connection',{periodInMinutes:0.5});
  try {
    const version=chrome.runtime.getManifest().version;
    await chrome.sidePanel.setOptions({path:'observer.html?v='+encodeURIComponent(version),enabled:true});
  } catch {}
  await discoverExistingChatTabs();
  await publishChatTabInventory(true);
  void poll();
})();
