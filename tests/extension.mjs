import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const sources = await Promise.all(['core.js', 'read-page.js', 'background.js'].map(name => readFile(new URL(`../firefox/${name}`, import.meta.url), 'utf8')));
const page = { id: 7, url: 'https://www.linkedin.com/messaging/', title: 'Messages', status: 'complete', active: true, incognito: false };
const token = 'a'.repeat(43);
function event() {
  return { listeners: [], addListener(fn) { this.listeners.push(fn); }, emit(...args) { return Promise.all(this.listeners.map(fn => fn(...args))); } };
}
async function harness(saved = {}) {
  const tabs = new Map([[page.id, { ...page }]]), writes = [], badges = [], requests = [];
  const browser = {
    runtime: { id: 'bridge@dzzk.test', getURL: path => `moz-extension://bridge/${path}`, onMessage: event(), onInstalled: event(), openOptionsPage: async () => {} },
    tabs: {
      get: async id => { if (!tabs.has(id)) throw new Error('No tab'); return { ...tabs.get(id) }; },
      query: async query => [...tabs.values()].filter(tab => query?.active ? tab.active===true : true).map(tab=>({...tab})),
      onUpdated: event(), onRemoved: event()
    },
    scripting: { executeScript: async () => [{ result: { url: page.url, title: page.title, text: 'A recruiter requested a GCP assignment. GCP evidence.' } }] },
    action: { setBadgeText: async value => badges.push(value), setBadgeBackgroundColor: async () => {} },
    storage: { local: { get: async () => saved, set: async value => writes.push(JSON.parse(JSON.stringify(value))) } },
    alarms: { create: async () => {}, onAlarm: event() }
  };
  const context = vm.createContext({ browser, crypto: webcrypto, URL, AbortController, setTimeout, clearTimeout, fetch: async (url, options) => { requests.push({url, options}); return {ok: true, json: async () => ({})}; } });
  sources.forEach(source => vm.runInContext(source, context));
  await new Promise(resolve => setImmediate(resolve));
  const evaluate = source => vm.runInContext(source, context);
  const send = (message, sender = {id: browser.runtime.id,url:browser.runtime.getURL('popup.html')}) => browser.runtime.onMessage.listeners[0](message, sender);
  // Enable without starting the polling loop, to test commands deterministically.
  const connect = () => evaluate(`config = {enabled:true,endpoint:'http://127.0.0.1:43119',token:'${token}'}; status = 'Connected';`);
  return { browser, tabs, writes, badges, requests, evaluate, send, connect, setFetch: fn => { context.fetch = fn; } };
}

test('grants accept normal HTTP(S), keep tab IDs private, expire and invalidate old handles', async () => {
  const h = await harness();
  const grants = h.evaluate('new DzzkGrants()');
  for (const url of ['file:///tmp/secret', 'about:config', 'moz-extension://other/options.html', 'data:text/html,secret']) {
    assert.throws(() => grants.share({...page,url}), /normal HTTP/);
  }
  assert.throws(() => grants.share({...page,url:undefined}), /normal HTTP/);
  assert.throws(() => grants.share({...page,url:'not a url'}), /normal HTTP/);
  assert.throws(() => grants.share({...page,incognito:true}), /normal HTTP/);
  const first = grants.share(page, 1000), second = grants.share(page, 2000);
  assert.notEqual(first, second);
  assert.throws(() => grants.get(first, 2001), /not shared/);
  assert.equal(grants.list(2001).length, 1);
  assert.equal('tabId' in grants.list(2001)[0], false);
  assert.equal(grants.list(1802000).length, 0);
  assert.throws(() => grants.get(second, 1802000), /expired/);
});

test('UI is restricted to the extension, loaded active tabs and a fixed pairing endpoint', async () => {
  const h = await harness();
  await assert.rejects(h.send({type:'share',tabId:7}), /Connect the companion/);
  h.connect();
  for (const sender of [{id:'other'}, {id:h.browser.runtime.id,tab:page,url:page.url}, {id:h.browser.runtime.id,url:'moz-extension://other/popup.html'}, {id:h.browser.runtime.id,url:h.browser.runtime.getURL('read-page.js')}]) {
    await assert.rejects(h.send({type:'state'},sender), /Only extension UI/);
  }
  h.tabs.set(7,{...page,active:false});
  await assert.rejects(h.send({type:'share',tabId:7}), /fully loaded/);
  h.tabs.set(7,{...page,status:'loading'});
  await assert.rejects(h.send({type:'share',tabId:7}), /fully loaded/);
  for (const endpoint of ['https://example.org', 'http://localhost:43119', 'http://127.0.0.1:43119/path', 'http://user@127.0.0.1:43119', 'http://127.0.0.1:43119/?x=1']) {
    await assert.rejects(h.send({type:'configure',config:{enabled:false,endpoint,token}}), /Companion address/);
  }
  await assert.rejects(h.send({type:'configure',config:{enabled:false,endpoint:'http://127.0.0.1:43119',token:'bad'}}), /43-character/);
});

// A small DOM model for extraction behavior; real browser coverage lives in the E2E test.
class Element {
  constructor(tag, text = '', attributes = {}, style = {}) {
    this.tagName = tag.toUpperCase(); this.text = text; this.attributes = attributes; this.style = style; this.children = [];
    this.hidden = attributes.hidden === true; this.isContentEditable = attributes.contenteditable === true;
  }
  append(child) { child.parent = this; this.children.push(child); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  getAttribute(name) { return this.attributes[name]; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  querySelectorAll(selector) {
    const all = this.children.flatMap(child => [child, ...child.querySelectorAll('*')]);
    return selector === '*' ? all : all.filter(child => selector.split(',').includes(child.tagName.toLowerCase()));
  }
  cloneNode() {
    const copy = new Element(this.tagName,this.text,this.attributes,this.style);
    this.children.forEach(child => copy.append(child.cloneNode())); return copy;
  }
}
function readDocument(body, expectedUrl = page.url, limit = 60000) {
  const context = vm.createContext({
    location:{href:page.url}, document:{body,title:'Evidence',createTextNode:text => new Element('#text',text)},
    getComputedStyle: element => ({display:'block',visibility:'visible',...element.style})
  });
  vm.runInContext(sources[1],context);
  return vm.runInContext(`dzzkReadPage(${JSON.stringify(expectedUrl)},${limit})`,context);
}
test('page extraction omits hidden content, scripts and form drafts while retaining visible evidence', () => {
  const body = new Element('body');
  body.append(new Element('p','Visible recruiter evidence'));
  for (const tag of ['script','style','noscript','template','input','textarea','select']) body.append(new Element(tag,'SECRET'));
  body.append(new Element('div','SECRET',{hidden:true}));
  body.append(new Element('div','SECRET',{'aria-hidden':'true'}));
  body.append(new Element('div','SECRET',{contenteditable:true}));
  body.append(new Element('div','SECRET',{}, {display:'none'}));
  body.append(new Element('div','SECRET',{}, {visibility:'hidden'}));
  const result = readDocument(body);
  assert.equal(result.text,'Visible recruiter evidence');
  assert.equal(result.truncated,false);
  assert.match(result.sourceTrust,/Untrusted/);
  assert.equal(readDocument(body,page.url,7).text,'Visible');
  assert.equal(readDocument(body,page.url,7).truncated,true);
  assert.throws(() => readDocument(body,'https://different.example/'),/Page changed/);
});

test('hidden or editable document roots and missing bodies return no evidence', () => {
  for (const body of [null,
    new Element('body','SECRET',{hidden:true}),
    new Element('body','SECRET',{'aria-hidden':'true'}),
    new Element('body','SECRET',{contenteditable:true}),
    new Element('body','SECRET',{}, {display:'none'}),
    new Element('body','SECRET',{}, {visibility:'hidden'})]) {
    assert.equal(readDocument(body).text,'');
  }
});

test('commands expose only granted pages and fixed read methods', async () => {
  const h = await harness(); h.connect();
  const {handle} = await h.send({type:'share',tabId:7});
  const run = command => h.evaluate(`runCommand(${JSON.stringify(command)})`);
  const listed = await run({method:'tabs.list'});
  assert.equal(listed.tabs[0].handle, handle);
  assert.equal('tabId' in listed.tabs[0], false);
  let injected;
  h.browser.scripting.executeScript = async spec => { injected = spec; return [{result:{text:'GCP test; gcp result',url:page.url}}]; };
  const result = await run({method:'page.read',args:{handle,maxChars:1e9}});
  assert.equal(result.handle, handle);
  assert.equal(injected.target.tabId,7);
  assert.equal(injected.args[1],60000);
  assert.equal(injected.func.name,'dzzkReadPage');
  const found = await run({method:'page.find',args:{handle,query:'gCp'}});
  assert.equal(found.matches.length,2);
  assert.equal('text' in found,false);
  for (const method of ['page.click','page.type','cookies.getAll','script.execute','page.navigate']) {
    await assert.rejects(run({method,args:{handle}}), /Unsupported operation/);
  }
  await assert.rejects(run({method:'page.read',args:{handle:'foreign-handle'}}), /not shared/);
  await assert.rejects(run({method:'page.find',args:{handle,query:' '}}), /Query/);
});

test('revoke and navigation during injection discard the result', async () => {
  for (const kind of ['revoke','navigate','removed']) {
    const h = await harness(); h.connect();
    const {handle} = await h.send({type:'share',tabId:7});
    let complete, entered;
    const started = new Promise(resolve => entered = resolve);
    h.browser.scripting.executeScript = () => { entered(); return new Promise(resolve => complete = resolve); };
    const pending = h.evaluate(`runCommand({method:'page.read',args:{handle:'${handle}'}})`);
    await started;
    if (kind === 'revoke') await h.send({type:'revoke',handle});
    if (kind === 'navigate') await h.browser.tabs.onUpdated.emit(7,{status:'loading'});
    if (kind === 'removed') await h.browser.tabs.onRemoved.emit(7);
    complete([{result:{text:'This text must never leave the browser'}}]);
    await assert.rejects(pending,/not shared|expired|changed/);
  }
});

test('URL changes revoke grants even without a navigation event', async () => {
  const h = await harness(); h.connect();
  const {handle} = await h.send({type:'share',tabId:7});
  let injections = 0;
  h.browser.scripting.executeScript = async () => {injections++; return [{result:{text:'private'}}];};
  h.tabs.set(7,{...page,url:'https://www.linkedin.com/feed/'});
  await assert.rejects(h.evaluate(`runCommand({method:'page.read',args:{handle:'${handle}'}})`),/Page changed/);
  assert.equal(injections,0);
  assert.equal((await h.send({type:'state'})).grants.length,0);
});

test('disconnect clears access and persisted configuration never restores grants', async () => {
  const h = await harness(); h.connect();
  const {handle} = await h.send({type:'share',tabId:7});
  await h.send({type:'disconnect'});
  assert.equal((await h.send({type:'state'})).grants.length,0);
  await assert.rejects(h.evaluate(`runCommand({method:'page.read',args:{handle:'${handle}'}})`),/disconnected/);
  assert.deepEqual(Object.keys(h.writes.at(-1)),['config']);
  assert.equal(h.writes.at(-1).config.enabled,false);
  const restored = await harness(h.writes.at(-1));
  assert.equal((await restored.send({type:'state'})).grants.length,0);
  assert.equal(restored.requests.length,0);
});

test('global pause cancels an in-flight read, clears badges and requires new grants after resume', async () => {
  const h = await harness(); h.connect();
  const {handle} = await h.send({type:'share',tabId:7});
  let complete, entered;
  const started = new Promise(resolve => entered = resolve);
  h.browser.scripting.executeScript = () => { entered(); return new Promise(resolve => complete = resolve); };
  const pending = h.evaluate(`runCommand({method:'page.read',args:{handle:'${handle}'}})`);
  await started;
  await h.send({type:'set-policy',paused:true});
  const paused = await h.send({type:'state'});
  assert.equal(paused.paused,true);
  assert.equal(paused.grants.length,0);
  assert.equal(paused.actions.length,0);
  assert.equal(h.badges.at(-1).tabId,7);
  assert.equal(h.badges.at(-1).text,'');
  complete([{result:{text:'In-flight secret must be discarded'}}]);
  await assert.rejects(pending,/not shared|expired|paused/);
  await assert.rejects(h.send({type:'share',tabId:7}),/paused/);
  await assert.rejects(h.evaluate(`runCommand({method:'tabs.list'})`),/paused/);
  await h.send({type:'set-policy',paused:false});
  assert.equal((await h.send({type:'state'})).paused,false);
  assert.equal((await h.send({type:'state'})).grants.length,0);
  await assert.rejects(h.evaluate(`runCommand({method:'page.read',args:{handle:'${handle}'}})`),/not shared/);
  const renewed = await h.send({type:'share',tabId:7});
  assert.notEqual(renewed.handle,handle);
});

test('failed pause/resume retains the local prohibition and persists it across extension restart', async () => {
  const h = await harness(); h.connect();
  await h.send({type:'share',tabId:7});
  h.setFetch(async () => ({ok:false}));
  await assert.rejects(h.send({type:'set-policy',paused:true}),/Companion refused/);
  assert.equal((await h.send({type:'state'})).paused,true);
  assert.equal((await h.send({type:'state'})).grants.length,0);
  assert.equal(h.writes.at(-1).localPaused,true);
  await assert.rejects(h.send({type:'set-policy',paused:false}),/Companion refused/);
  assert.equal((await h.send({type:'state'})).paused,true);
  assert.equal(h.writes.some(write => write.localPaused === false),false);
  await assert.rejects(h.send({type:'share',tabId:7}),/paused/);
  await assert.rejects(h.evaluate(`runCommand({method:'bridge.status'})`),/paused/);
  const restarted = await harness({config:{enabled:false,endpoint:'http://127.0.0.1:43119',token},localPaused:true});
  restarted.connect();
  assert.equal((await restarted.send({type:'state'})).paused,true);
  assert.equal((await restarted.send({type:'state'})).grants.length,0);
  await assert.rejects(restarted.send({type:'share',tabId:7}),/paused/);
  await restarted.send({type:'set-policy',paused:false});
  assert.equal((await restarted.send({type:'state'})).paused,false);
  assert.equal(restarted.writes.at(-1).localPaused,false);
});

test('Chrome observer Help wiring uses one toggle ID and no duplicate element IDs', async () => {
  const html = await readFile(new URL('../chrome/observer.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../chrome/observer.js', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const duplicates = [...new Set(ids.filter((id,index) => ids.indexOf(id)!==index))];
  assert.deepEqual(duplicates,[]);
  assert.match(html,/id="help-toggle"/);
  assert.match(js,/(?:\$|must)\('help-toggle'\)\.addEventListener/);
  assert.match(html,/id="runtime-grid"/);
  assert.match(html,/id="help-runtime-grid"/);
  assert.equal(ids.filter(id=>id==='runtime-grid').length,1);
  assert.equal(ids.filter(id=>id==='help-runtime-grid').length,1);
});

test('Chrome Observer exposes timeline correlation and source quality', async () => {
  const js = await readFile(new URL('../chrome/observer.js', import.meta.url), 'utf8');
  assert.match(js,/source_quality=/);
  assert.match(js,/conversation=/);
  assert.match(js,/turn=/);
  assert.match(js,/span=/);
});

test('Chrome Observer surfaces MCP connection consent in the main side panel', async () => {
  const html = await readFile(new URL('../chrome/observer.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../chrome/observer.js', import.meta.url), 'utf8');
  assert.match(html,/id="connection-requests"/);
  assert.match(js,/Connection request:/);
  assert.match(js,/type:'consent'/);
  assert.match(js,/refreshConnectionRequests\(\)/);
});

test('a new pause takes precedence over an earlier pending resume', async () => {
  const h = await harness(); h.connect();
  await h.send({type:'set-policy',paused:true});
  let completeResume, entered;
  const started = new Promise(resolve => entered = resolve), calls = [];
  h.setFetch(async (url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    if (body.paused === false) { entered(); return new Promise(resolve => completeResume = () => resolve({ok:true,json:async () => ({ok:true})})); }
    return {ok:true,json:async () => ({ok:true})};
  });
  const resume = h.send({type:'set-policy',paused:false});
  await started;
  const pause = h.send({type:'set-policy',paused:true});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await h.send({type:'state'})).paused,true);
  completeResume();
  await Promise.all([resume,pause]);
  assert.equal((await h.send({type:'state'})).paused,true);
  assert.deepEqual(calls,[{paused:false},{paused:true}]);
  assert.equal(h.writes.some(write => write.localPaused === false),false);
});

test('permission policy and per-action approval are restricted to the extension UI', async () => {
  const h = await harness(); h.connect();
  for (const sender of [{id:'other',url:h.browser.runtime.getURL('popup.html')},{id:h.browser.runtime.id,url:page.url}]) {
    for (const message of [{type:'set-policy',paused:true},{type:'set-policy',clientId:'client-1',method:'page.read',mode:'allow'},{type:'action-consent',id:'action-1',allow:true}]) {
      await assert.rejects(h.send(message,sender),/Only extension UI/);
    }
  }
  assert.equal(h.requests.length,0);
  for (const policy of [{method:'page.click',mode:'allow'},{method:'page.read',mode:'run'},{method:'page.read',mode:'allow',clientId:42}]) {
    await assert.rejects(h.send({type:'set-policy',clientId:'client-1',...policy}),/Invalid permission/);
  }
  for (const mode of ['allow','ask','block']) await h.send({type:'set-policy',clientId:'client-1',method:'page.read',mode});
  await h.send({type:'action-consent',id:'action-1',allow:true});
  await h.send({type:'action-consent',id:'action-2',allow:'yes'});
  assert.deepEqual(h.requests.map(request => ({path:new URL(request.url).pathname,body:JSON.parse(request.options.body)})),[
    ...['allow','ask','block'].map(mode => ({path:'/bridge/policy',body:{clientId:'client-1',method:'page.read',mode}})),
    {path:'/bridge/action-consent',body:{id:'action-1',allow:true}},
    {path:'/bridge/action-consent',body:{id:'action-2',allow:false}}
  ]);
});

test('Observer labels terminal lifecycle as Last task and does not treat WAITING process spans as active', async () => {
  const html = await readFile(new URL('../chrome/observer.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../chrome/observer.js', import.meta.url), 'utf8');
  assert.match(html,/id="task-lifecycle-title"/);
  assert.match(js,/terminal\?'Last task':'Current task'/);
  assert.match(js,/function activeSpans/);
  assert.match(js,/s=>s\.status==='RUNNING'/);
});

test('Observer hides stale waiting TERM sessions from recent execution spans', async () => {
  const js = await readFile(new URL('../chrome/observer.js', import.meta.url), 'utf8');
  assert.match(js,/s\.actor==='TERM' && age>30/);
  assert.match(js,/hour12:false/);
  assert.match(js,/c\.correlation_id/);
});


test('Observer renders a correlation-focused trace above the raw timeline', async () => {
  const html = await readFile(new URL('../chrome/observer.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../chrome/observer.js', import.meta.url), 'utf8');
  assert.match(html,/id="trace-section"/);
  assert.match(html,/id="trace-meta"/);
  assert.match(html,/id="trace"/);
  assert.match(js,/function renderTrace\(state\)/);
  assert.match(js,/renderTrace\(state\)/);
  assert.match(js,/chooseTraceCorrelation/);
  assert.match(js,/correlationShort/);
  assert.match(js,/c\.correlation_id\?'\['\+correlationShort/);
});


test('Observer surfaces Remote Desktop activity and background processes', async () => {
  const html = await readFile(new URL('../chrome/observer.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../chrome/observer.js', import.meta.url), 'utf8');
  assert.match(html,/id="rdc-section"/);
  assert.match(html,/id="rdc-meta"/);
  assert.match(html,/id="rdc-activity"/);
  assert.match(html,/trace-ui12/);
  assert.match(js,/function renderRdc\(state\)/);
  assert.match(js,/background open · gateway not authoritative/);
  assert.match(js,/state\.rdc\?\.last_activity_seconds/);
  assert.match(js,/state\.rdc\?\.open_count/);
});


test('Observer distinguishes degraded snapshot failure from companion offline', async () => {
  const bg = await readFile(new URL('../chrome/background.js', import.meta.url), 'utf8');
  const js = await readFile(new URL('../chrome/observer.js', import.meta.url), 'utf8');
  assert.match(bg,/observer_unavailable: Observer snapshot is unavailable/);
  assert.match(bg,/invalid_pairing: Companion rejected the extension pairing token/);
  assert.match(js,/degraded\?'DEGRADED':'OFFLINE'/);
  assert.match(js,/Observer snapshot unavailable/);
  assert.match(js,/Companion unavailable/);
});


test('Observer folds unscoped external activity into attribution diagnostics while preserving recent trace evidence', async () => {
  const html = await readFile(new URL('../chrome/observer.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../chrome/observer.js', import.meta.url), 'utf8');
  assert.match(html,/id="trace-title"/);
  assert.match(html,/Attribution \/ causal trace/);
  assert.match(js,/function currentExternalActivity\(state\)/);
  assert.match(js,/Attribution diagnostics/);
  assert.match(js,/Recent correlated trace /);
  assert.match(js,/awaiting authoritative gateway/);
});


test('Observer surfaces detached Harness ownership and heartbeat without log activity', async () => {
  const html = await readFile(new URL('../chrome/observer.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../chrome/observer.js', import.meta.url), 'utf8');
  assert.match(html,/id="detached-run-section"/);
  assert.match(html,/Execution &amp; ownership/);
  assert.match(html,/trace-ui12/);
  assert.match(js,/function detachedRunHealth\(state\)/);
  assert.match(js,/HARNESS .*detached/);
  assert.match(js,/heartbeat_age_seconds>8/);
});


test('Observer exposes recent attribution health instead of a permanent gateway-gap CTA', async () => {
  const html = await readFile(new URL('../chrome/observer.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../chrome/observer.js', import.meta.url), 'utf8');
  assert.match(html,/id="attribution-health"/);
  assert.doesNotMatch(html,/Gap: ChatGPT turn → Harness gateway/);
  assert.match(js,/function recentAttributionHealth\(state/);
  assert.match(js,/Chat attribution · healthy/);
  assert.match(js,/Chat attribution · degraded/);
  assert.match(js,/attribution-health.*addEventListener/s);
});


test('terminal detached runs show finished age instead of stale heartbeat', async () => {
  const js = await readFile(new URL('../chrome/observer.js', import.meta.url), 'utf8');
  assert.match(js,/finished .* ago/);
  assert.match(js,/heartbeat unknown/);
});


test('Observer keeps prepared dispatch as an explicit Run action rather than a separate top-level concept', async () => {
  const html = await readFile(new URL('../chrome/observer.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../chrome/observer.js', import.meta.url), 'utf8');
  const bg = await readFile(new URL('../chrome/background.js', import.meta.url), 'utf8');
  const runIndex=html.indexOf('id="run-section"');
  const preparedIndex=html.indexOf('id="prepared-dispatch"');
  assert.ok(runIndex>=0 && preparedIndex>runIndex);
  assert.match(html,/id="dispatch-prepared"[^>]*>Dispatch</);
  assert.match(js,/refreshPreparedDispatch/);
  assert.match(js,/type:'dispatch-prepared'/);
  assert.match(bg,/case 'dispatch-state'/);
  assert.match(bg,/case 'dispatch-prepared'/);
});


test('Work and diagnostics use progressive disclosure while prepared dispatch is run metadata', async () => {
  const html = await readFile(new URL('../chrome/observer.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../chrome/observer.js', import.meta.url), 'utf8');
  assert.match(html,/<details id="task-lifecycle-section" class="panel-section"/);
  assert.match(html,/<details id="run-section" class="panel-section"/);
  assert.match(html,/<details id="project-status-section" class="panel-section"/);
  assert.match(html,/<details id="spans-section" class="panel-section"/);
  assert.match(html,/<details id="rdc-section" class="panel-section"/);
  assert.match(html,/<details id="trace-section" class="panel-section"/);
  assert.match(html,/id="prepared-result-section"/);
  assert.match(html,/id="prepared-dispatch"/);
  assert.match(js,/function renderRunMeta\(state\)/);
  assert.match(js,/function setDisclosureDefault\(section, open\)/);
});

test('Raw timeline no longer uses opaque xN repeat compaction', async () => {
  const js = await readFile(new URL('../chrome/observer.js', import.meta.url), 'utf8');
  assert.match(js,/Raw timeline must stay literal/);
  assert.doesNotMatch(js,/rep\.textContent='×'/);
});


test('GW-01 correlation acceptance control is explicit and separate from gateway explanation', async () => {
  const html = await readFile(new URL('../chrome/observer.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../chrome/observer.js', import.meta.url), 'utf8');
  const bg = await readFile(new URL('../chrome/background.js', import.meta.url), 'utf8');
  assert.match(html,/Run GW-01 correlation acceptance/);
  assert.match(html,/id="gw01-acceptance-status"/);
  assert.match(js,/type:'gw01-acceptance'/);
  assert.match(js,/action→MCP/);
  assert.match(bg,/case 'gw01-acceptance'/);
});

test('GW-01 extension binds two ChatGPT tabs to distinct conversation ids and survives reload', async () => {
  const h=await harness();
  const chatA={id:8,url:'https://chatgpt.com/c/chat-A',title:'Chat A',status:'complete',active:true,incognito:false};
  const chatB={id:9,url:'https://chatgpt.com/c/chat-B',title:'Chat B',status:'complete',active:true,incognito:false};
  h.tabs.set(8,chatA); h.tabs.set(9,chatB);
  const a=await h.send({type:'conversation-bind',tabId:8});
  const b=await h.send({type:'conversation-bind',tabId:9});
  assert.equal(a.binding.conversation_id,'chat-A');
  assert.equal(b.binding.conversation_id,'chat-B');
  assert.equal(a.binding.source_quality,'browser_observed');
  assert.equal(b.binding.source_quality,'browser_observed');
  assert.notEqual(a.binding.conversation_id,b.binding.conversation_id);

  const state=await h.send({type:'conversation-state'});
  assert.equal(state.bindings.length,2);
  const persisted=h.writes.filter(x=>Array.isArray(x.conversationBindings)).at(-1);
  assert.ok(persisted);

  const reloaded=await harness({conversationBindings:persisted.conversationBindings});
  const after=await reloaded.send({type:'conversation-state'});
  const afterPairs=after.bindings.map(x=>[x.tabId,x.conversation_id]).sort((x,y)=>x[0]-y[0]);
  const statePairs=state.bindings.map(x=>[x.tabId,x.conversation_id]).sort((x,y)=>x[0]-y[0]);
  assert.equal(JSON.stringify(afterPairs),JSON.stringify(statePairs));
});

test('GW-01 extension refuses non-ChatGPT binding and revokes binding on navigation', async () => {
  const h=await harness();
  await assert.rejects(h.send({type:'conversation-bind',tabId:7}),/Only normal ChatGPT HTTPS tabs/);
  const chat={id:8,url:'https://chatgpt.com/c/chat-A',title:'Chat A',status:'complete',active:true,incognito:false};
  h.tabs.set(8,chat);
  await h.send({type:'conversation-bind',tabId:8});
  assert.equal((await h.send({type:'conversation-state'})).bindings.length,1);
  await h.browser.tabs.onUpdated.emit(8,{url:'https://chatgpt.com/c/chat-B'});
  assert.equal((await h.send({type:'conversation-state'})).bindings.length,0);
});

test('GW-01 extension auto-admits the active saved ChatGPT conversation from its real URL identity', async () => {
  const h=await harness();
  const chat={id:8,url:'https://chatgpt.com/c/chat-A',title:'Chat A',status:'complete',active:true,incognito:false};
  h.tabs.set(7,{...page,active:false});
  h.tabs.set(8,chat);
  const current=await h.send({type:'conversation-current'});
  assert.equal(current.binding.conversation_id,'chat-A');
  assert.equal(current.binding.source_quality,'browser_observed');
  const state=await h.send({type:'conversation-state'});
  assert.equal(state.bindings.length,1);
  h.tabs.set(8,{...chat,active:false});
  h.tabs.set(7,{...page,active:true});
  assert.equal((await h.send({type:'conversation-current'})).binding,null);
});

test('GW-01 Observer exposes chat-scoped timeline projections without changing the global ledger', async () => {
  const html=await readFile(new URL('../chrome/observer.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  const bg=await readFile(new URL('../chrome/background.js',import.meta.url),'utf8');
  assert.match(html,/id="timeline-scope"/);
  assert.match(html,/All activity/);
  assert.match(html,/Unscoped/);
  assert.doesNotMatch(html,/Current chat/);
  assert.doesNotMatch(html,/Other chats/);
  assert.match(html,/id="current-conversation"/);
  assert.match(js,/function timelineEventsForScope\(events,scope,binding\)/);
  assert.match(js,/scope==='unscoped'/);
  assert.doesNotMatch(html,/id="chat-selector"/);
  assert.match(html,/All activity/);
  assert.match(js,/type:'conversation-state'/);
  assert.match(js,/knownConversationBindings/);
  assert.match(js,/scope\.startsWith\('chat:'\)/);
  assert.match(js,/LIVE .*allEvents\.length/);
  assert.match(bg,/case 'chat-context-observed'/);
  assert.match(bg,/case 'conversation-state'/);
  assert.match(bg,/\/bridge\/conversation-active/);
});


test('ChatGPT content script derives conversation identity from each tab URL independently of browser focus', async () => {
  const manifest=JSON.parse(await readFile(new URL('../chrome/manifest.json',import.meta.url),'utf8'));
  const script=await readFile(new URL('../chrome/chat-context.js',import.meta.url),'utf8');
  assert.ok(manifest.host_permissions.includes('https://chatgpt.com/*'));
  assert.ok((manifest.content_scripts||[]).some(x=>(x.matches||[]).includes('https://chatgpt.com/*')&&(x.js||[]).includes('chat-context.js')));
  assert.match(script,/pathname\.split/);
  assert.match(script,/type:'chat-context-observed'/);
  assert.doesNotMatch(script,/tabs\.query\(\{active:true/);
});


test('ChatGPT turn detector uses composer lifecycle without reading message text', async () => {
  const script=await readFile(new URL('../chrome/chat-context.js',import.meta.url),'utf8');
  assert.ok(script.includes("addEventListener('submit'"));
  assert.match(script,/composer-submit/);
  assert.match(script,/generating-control-present/);
  assert.match(script,/type:'chat-turn-observed'/);
  assert.match(script,/detector_version:'turn-v3'/);
  assert.doesNotMatch(script,/.innerText/);
  assert.doesNotMatch(script,/.textContent/);
});


test('Chrome Observer exposes explicit semver reload only when disk and loaded versions differ', async () => {
  const html=await readFile(new URL('../chrome/observer.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  const bg=await readFile(new URL('../chrome/background.js',import.meta.url),'utf8');
  const manifest=JSON.parse(await readFile(new URL('../chrome/manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.version,'0.1.19');
  assert.match(html,/id="extension-version"/);
  assert.match(html,/id="reload-version"/);
  assert.match(js,/Reload '\+loaded\+' → '\+disk/);
  assert.match(js,/type:'reload-extension'/);
  assert.match(bg,/case 'reload-extension'/);
  assert.doesNotMatch(bg,/reloadRevision>seenReloadRevision\)[\s\S]{0,160}chrome\.runtime\.reload/);
});


test('CHR-02 versioned reload is explicit and semver surfaces are synchronized', async () => {
  const html=await readFile(new URL('../chrome/observer.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  const bg=await readFile(new URL('../chrome/background.js',import.meta.url),'utf8');
  const chromeManifest=JSON.parse(await readFile(new URL('../chrome/manifest.json',import.meta.url),'utf8'));
  const firefoxManifest=JSON.parse(await readFile(new URL('../firefox/manifest.json',import.meta.url),'utf8'));
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.version,'0.1.19');
  assert.equal(chromeManifest.version,pkg.version);
  assert.equal(firefoxManifest.version,pkg.version);
  assert.match(html,/id="extension-version"/);
  assert.match(html,/id="reload-version"/);
  assert.match(js,/Reload '\+loaded\+' → '\+disk/);
  assert.match(js,/type:'reload-extension'/);
  assert.match(bg,/pendingReloadRevision=reloadRevision/);
  assert.match(bg,/case 'reload-extension'/);
  const poll=bg.slice(bg.indexOf('async function poll()'),bg.indexOf('chrome.tabs.onUpdated'));
  assert.doesNotMatch(poll,/chrome\.runtime\.reload\(\)/);
});


test('chat-scope change invalidates timeline render cache even when filtered result is empty', async () => {
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  assert.match(js,/let renderedKeys=null/);
  assert.match(js,/Array\.isArray\(renderedKeys\)/);
  assert.match(js,/timelineScope=event\.target\.value;[\s\S]*renderedKeys=null;[\s\S]*renderTimeline\(lastState\)/);
});


test('Unified timeline merges and labels the active ChatGPT conversation in its single selector', async () => {
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  assert.match(js,/type:'conversation-current'/);
  assert.match(js,/is_current:true/);
  assert.match(js,/Current · /);
  assert.doesNotMatch(js,/id=['"]chat-selector/);
});


test('version mismatch action has a dedicated Side Panel row', async () => {
  const html=await readFile(new URL('../chrome/observer.html',import.meta.url),'utf8');
  const css=await readFile(new URL('../chrome/observer.css',import.meta.url),'utf8');
  assert.match(html,/class="version-line"/);
  assert.match(html,/id="reload-version"/);
  assert.match(css,/\.version-line\s*\{/);
  assert.match(css,/\.version-line \.version-reload/);
});


test('Side Panel exposes gateway runtime vs repository identity and restart warning', async () => {
  const html=await readFile(new URL('../chrome/observer.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  assert.match(html,/id="gateway-version"/);
  assert.match(js,/Gateway restart /);
  assert.match(js,/gateway_version/);
  assert.match(js,/restart_required/);
});


test('Side Panel document is versioned and self-heals after extension runtime reload', async () => {
  const html=await readFile(new URL('../chrome/observer.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  const bg=await readFile(new URL('../chrome/background.js',import.meta.url),'utf8');
  assert.match(html,/data-build-version="0\.1\.19"/);
  assert.match(js,/panelDocumentVersion/);
  assert.match(js,/location\.replace\(target\)/);
  assert.match(bg,/chrome\.sidePanel\.setOptions\(\{path:'observer\.html\?v='/);
  assert.match(bg,/uiPaths = new Set\(\['\/popup\.html','\/options\.html','\/observer\.html'\]\)/);
  assert.match(bg,/uiPaths\.has\(u\.pathname\)/);
});


test('scoped timeline events expose explicit source-chat navigation', async () => {
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  const bg=await readFile(new URL('../chrome/background.js',import.meta.url),'utf8');
  assert.match(js,/Open source chat/);
  assert.match(js,/type:'conversation-open'/);
  assert.match(bg,/case 'conversation-open'/);
  assert.match(bg,/tabs\.update\(tab\.id,\{active:true\}\)/);
  assert.match(bg,/tabs\.create\(\{url:binding\.url,active:true\}\)/);
});


test('ChatGPT turn detector recovers an active turn when generation outlives local turn state', async () => {
  const js=await readFile(new URL('../chrome/chat-context.js',import.meta.url),'utf8');
  assert.match(js,/if\(!activeTurn && isGenerating\)/);
  assert.match(js,/generating-without-active-turn-recovery/);
  assert.match(js,/sendTurn\('ACTIVE','generating-control-present'\)/);
});


test('Unified timeline scope selector is a persistent DOM island across polling refreshes', async () => {
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  assert.match(js,/timelineScopeOptionsFingerprint/);
  assert.match(js,/function reconcileTimelineScopeOptions/);
  assert.match(js,/if\(fingerprint===timelineScopeOptionsFingerprint\) return false/);
  const refreshBlock=js.slice(js.indexOf('knownConversationBindings=[...byMergedId.values()]'),js.indexOf('    } catch {',js.indexOf('knownConversationBindings=[...byMergedId.values()]')));
  assert.doesNotMatch(refreshBlock,/selector\.replaceChildren\(/);
  assert.match(refreshBlock,/reconcileTimelineScopeOptions\(selector,model\)/);
  assert.match(refreshBlock,/if\(selector\.value!==wanted\) selector\.value=wanted/);
});


test('UI-01 first viewport prioritizes actors, operator status, work summaries and evidence', async () => {
  const html=await readFile(new URL('../chrome/observer.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  const actorIndex=html.indexOf('id="actor-strip"');
  const statusIndex=html.indexOf('class="status-line"');
  assert.ok(actorIndex>=0 && statusIndex>actorIndex);
  assert.match(html,/id="version-line"[^>]*hidden/);
  assert.match(html,/id="timeline-section" class="evidence-section"/);
  assert.match(html,/<h2>Concepts<\/h2>/);
  assert.match(html,/<h2>Controls<\/h2>/);
  assert.match(html,/<h2>Diagnostics<\/h2>/);
  assert.match(js,/versionLine\.hidden=!gv\.restart_required/);
  assert.match(js,/Recent 2-minute work attribution/);
});


test('Task and Run summaries expose visible disclosure affordance and human-readable previews', async () => {
  const html=await readFile(new URL('../chrome/observer.html',import.meta.url),'utf8');
  const css=await readFile(new URL('../chrome/observer.css',import.meta.url),'utf8');
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  assert.match(html,/id="task-state"/);
  assert.match(html,/id="task-preview"/);
  assert.match(html,/id="run-state"/);
  assert.match(html,/id="run-preview"/);
  assert.match(html,/Open current task details: goal, state, progress, control and budget/);
  assert.match(html,/Open run details: current execution, prepared handoff and last result/);
  assert.match(css,/\.panel-section \{/);
  assert.match(css,/\.panel-summary:hover/);
  assert.match(js,/preview\.textContent='Last prepared handoff'/);
  assert.match(js,/stateLabel\.textContent='ACTION REQUIRED'/);
});

test('Prepared dispatch action disappears when companion reports no task is ready', async () => {
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  assert.match(js,/no prepared Harness task is ready/i);
  assert.match(js,/box\.hidden=true/);
  assert.match(js,/renderRunMeta\(lastState\)/);
});

test('Actor strip keeps MCP and RDC as distinct semantic actors', async () => {
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  assert.ok(js.includes("['MCP','','Model Context Protocol activity','protocol / connected-client boundary']"));
  assert.ok(js.includes("['RDC',state.rdc?.last_activity_seconds!=null?seconds(state.rdc.last_activity_seconds):'','Remote Desktop Commander','local transport']"));
  assert.doesNotMatch(js,/\['MCP',state\.rdc\?\.last_activity_seconds/);
});


test('Header keeps loaded version visible and exposes runtime diagnostics on help hover/focus', async () => {
  const html=await readFile(new URL('../chrome/observer.html',import.meta.url),'utf8');
  const css=await readFile(new URL('../chrome/observer.css',import.meta.url),'utf8');
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  assert.match(html,/id="help-toggle" class="icon-button"/);
  assert.doesNotMatch(html,/<details id="help-toggle"/);
  assert.match(html,/id="runtime-popover"/);
  assert.match(html,/id="runtime-grid" class="runtime-grid runtime-grid-compact"/);
  assert.match(html,/id="extension-version" class="header-version"/);
  assert.match(css,/\.help-cluster:hover \.runtime-popover/);
  assert.match(css,/\.help-cluster:focus-within \.runtime-popover/);
  assert.match(js,/label\.textContent='v'\+loaded/);
  assert.match(js,/versionLine\.hidden=!gv\.restart_required/);
  assert.match(js,/help-toggle.*addEventListener/s);
});


test('Actor strip scales horizontally and explicitly distinguishes Harness observation from ChatGPT integration', async () => {
  const html=await readFile(new URL('../chrome/observer.html',import.meta.url),'utf8');
  const css=await readFile(new URL('../chrome/observer.css',import.meta.url),'utf8');
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  assert.match(html,/Harness-observed actors and sources\. Presence here does not imply native ChatGPT integration/);
  assert.match(css,/\.actor-strip-primary \{[\s\S]*flex-wrap:nowrap/);
  assert.match(css,/overflow-x:auto/);
  assert.match(css,/scrollbar-width:none/);
  assert.match(js,/protocol \/ connected-client boundary/);
  assert.match(js,/local executor/);
  assert.match(js,/repository state/);
});

test('Attribution health is non-actionable unless recent attribution is degraded', async () => {
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  const css=await readFile(new URL('../chrome/observer.css',import.meta.url),'utf8');
  assert.match(js,/button\.disabled=true/);
  assert.match(js,/button\.setAttribute\('aria-disabled','true'\)/);
  assert.match(js,/Chat attribution · idle/);
  assert.match(js,/Chat attribution · healthy/);
  assert.match(js,/button\.disabled=false/);
  assert.match(js,/Chat attribution · degraded.*Inspect/);
  assert.match(css,/\.attribution-health:disabled/);
});


test('Current task uses one key-value grammar with per-field semantic help', async () => {
  const html=await readFile(new URL('../chrome/observer.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  assert.match(html,/id="task-lifecycle-work" class="run-summary"/);
  assert.match(js,/function appendKeyValues\(parent, rows\)/);
  assert.match(js,/k\.classList\.add\('has-help'\)/);
  assert.match(js,/Stable Harness task identifier/);
  assert.match(js,/Current orchestration phase inside the task lifecycle/);
  assert.match(js,/Latest durable progress marker/);
  assert.match(js,/Lifecycle steps already completed/);
  assert.match(js,/Execution limits allocated to this task/);
  assert.match(js,/Observed consumption of the allocated task budget/);
  assert.match(js,/task-preview.*title/s);
});

test('Task interruption badge explains safety semantics and is not itself an action', async () => {
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  assert.match(js,/Orchestration safety status/);
  assert.match(js,/This badge is informational/);
  const html=await readFile(new URL('../chrome/observer.html',import.meta.url),'utf8');
  assert.match(html,/id="task-safety" class="panel-meta panel-badge muted"/);
  assert.doesNotMatch(html,/id="task-safety"[^>]*<(button|a)/);
});

test('Chat attribution status names the attributed thing and distinguishes idle from failure', async () => {
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  assert.match(js,/Chat attribution · idle/);
  assert.match(js,/idle state, not a failure/);
  assert.match(js,/Chat attribution · healthy/);
  assert.match(js,/Chat attribution · degraded/);
});


test('Task disclosure uses card/hover affordance without reserving chevron space', async () => {
  const html=await readFile(new URL('../chrome/observer.html',import.meta.url),'utf8');
  const css=await readFile(new URL('../chrome/observer.css',import.meta.url),'utf8');
  assert.doesNotMatch(html,/panel-chevron/);
  assert.doesNotMatch(css,/\.panel-chevron/);
  assert.match(css,/grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(css,/\.panel-summary:hover/);
});

test('Task field help is quiet by default and emphasized only on hover or focus', async () => {
  const css=await readFile(new URL('../chrome/observer.css',import.meta.url),'utf8');
  const start=css.indexOf('.run-summary .key.has-help,\n.runtime-grid .key.has-help {');
  const hover=css.indexOf('.run-summary .key.has-help:hover',start);
  assert.ok(start>=0 && hover>start);
  const base=css.slice(start,hover);
  assert.match(base,/cursor:help/);
  assert.doesNotMatch(base,/text-decoration:underline dotted/);
  const interactive=css.slice(hover,css.indexOf('#task-preview',hover));
  assert.match(interactive,/text-decoration:underline dotted/);
  assert.match(css,/\.detail-group \+ \.detail-group \{ margin-top:13px; \}/);
});


test('Run reuses Current task semantic table grammar in two domain-specific groups', async () => {
  const html=await readFile(new URL('../chrome/observer.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  assert.match(html,/id="run-execution-group" class="detail-group"/);
  assert.match(html,/Execution &amp; ownership/);
  assert.match(html,/id="run-handoff-group" class="detail-group"/);
  assert.match(html,/Handoff &amp; result/);
  assert.match(html,/id="detached-run-summary" class="run-summary"/);
  assert.match(html,/id="prepared-result-summary" class="run-summary"/);
  assert.match(js,/Durable controller identity that owns this Harness execution/);
  assert.match(js,/Declared interruption boundary for this run/);
  assert.match(js,/Short correlation identifier linking this run result/);
  assert.match(js,/Files or durable outputs produced or changed by this run/);
});

test('Run summary preview exposes full text and prepared Dispatch remains inside handoff group', async () => {
  const html=await readFile(new URL('../chrome/observer.html',import.meta.url),'utf8');
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  const handoff=html.indexOf('id="run-handoff-group"');
  const dispatch=html.indexOf('id="prepared-dispatch"');
  assert.ok(handoff>=0 && dispatch>handoff);
  assert.match(js,/preview\.title=preview\.textContent/);
  assert.match(js,/Start this prepared task as a Harness-owned run/);
  assert.match(js,/function updateRunDetailGroups\(\)/);
});


test('Help explains macro/micro lifecycle boundaries and Project is not Chat', async () => {
  const html=await readFile(new URL('../chrome/observer.html',import.meta.url),'utf8');
  assert.match(html,/Conversation is context\. Project is delivery scope/);
  assert.match(html,/Project → Task → Prepared task → Dispatch → Run → Span → Event/);
  assert.match(html,/Project readiness.*not.*progress of the current ChatGPT conversation/s);
  assert.match(html,/one conversation may touch multiple Projects/i);
  assert.match(html,/Prepared task.*validated execution envelope/s);
  assert.match(html,/Dispatch.*Harness-owned execution/s);
  assert.match(html,/future label such as <strong>Execution<\/strong> or <strong>Execution cycle<\/strong>/);
});



test('Actor strip exposes browser CHAT turn as a first-class context actor', async () => {
  const js=await readFile(new URL('../chrome/observer.js',import.meta.url),'utf8');
  assert.ok(js.includes("['CHAT',state.chat_activity?.active?'active':'','ChatGPT browser turn','browser conversation / turn context']"));
  assert.match(js,/name==='CHAT' \? state\.chat_activity\?\.active===true/);
  const chatIndex=js.indexOf("['CHAT'");
  const mcpIndex=js.indexOf("['MCP'");
  assert.ok(chatIndex>=0 && mcpIndex>chatIndex);
});
