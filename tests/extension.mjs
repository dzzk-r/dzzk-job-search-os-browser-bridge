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
    tabs: { get: async id => { if (!tabs.has(id)) throw new Error('No tab'); return { ...tabs.get(id) }; }, onUpdated: event(), onRemoved: event() },
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
