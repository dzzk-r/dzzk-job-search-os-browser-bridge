import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridgeServer } from '../server/index.mjs';

async function setup(t) {
  const configDir=await mkdtemp(join(tmpdir(),'dzzk-server-test-'));
  const observerEventPath=join(configDir,'observer-events.jsonl');
  const browserTurnStatePath=join(configDir,'browser-turn-state.json');
  const bridge=await createBridgeServer({port:0,configDir,observerEventPath,browserTurnStatePath,executorPolicyPath:join(configDir,'executor-policy.json'),executorCompareRoot:join(configDir,'compare'),rdcIntentRoot:join(configDir,'rdc-intents'),observerSnapshot:async()=>({state:'DONE',active_source:'MCP',timeline:[{ts:1,source:'MCP',message:'test'}],versions:{mcp:'test'}})});
  t.after(async()=>{await bridge.close(); await rm(configDir,{recursive:true,force:true});});
  const call=async(path,{method='GET',data,token,headers={}}={})=>{
    const response=await fetch(bridge.issuer+path,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})});
    const text=await response.text(); let value; try{value=JSON.parse(text);}catch{value=text;} return {status:response.status,value,headers:response.headers};
  };
  const extension=(path,data,adapter='chrome')=>call('/bridge/'+path+'?adapter='+adapter,{method:data?'POST':'GET',data,token:bridge.pairingToken});
  const register=async()=> (await call('/register',{method:'POST',data:{client_name:'Test MCP Client',redirect_uris:['https://client.example/callback'],token_endpoint_auth_method:'none'}})).value;
  const authorize=async(client,verifier='v'.repeat(43),resource=bridge.resource)=>{
    const q=new URLSearchParams({client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),resource,scope:'browser.read',state:'test-state'});
    const page=await call('/authorize?'+q); assert.equal(page.status,200);
    const statusPath=JSON.parse(page.value.match(/const statusUrl=("[^"]+")/)[1]);
    const consent=(await extension('next')).value.consents.find(x=>x.name===(client.client_name||'Test MCP Client')); assert.ok(consent);
    assert.equal((await extension('consent',{id:consent.id,allow:true})).status,200);
    const result=await call(statusPath), redirect=new URL(result.value.redirect); assert.equal(redirect.searchParams.get('state'),'test-state'); assert.equal(redirect.searchParams.get('iss'),bridge.issuer);
    return {code:redirect.searchParams.get('code'),verifier,resource};
  };
  const tokenRequest=(client,grant,changes={})=>call('/token',{method:'POST',data:{grant_type:'authorization_code',client_id:client.client_id,redirect_uri:client.redirect_uris[0],resource:grant.resource ?? bridge.resource,code:grant.code,code_verifier:grant.verifier,...changes}});
  const mcp=(token,method,params={},path='/mcp')=>call(path,{method:'POST',token,data:{jsonrpc:'2.0',id:1,method,params},headers:{Accept:'application/json, text/event-stream'}});
  return {...bridge,configDir,observerEventPath,browserTurnStatePath,call,extension,register,authorize,tokenRequest,mcp};
}

test('canonical dashboard snapshot is pairing-protected and contains one revisioned control-plane state',async t=>{
  const b=await setup(t);
  assert.equal((await b.call('/bridge/dashboard-state?adapter=chrome')).status,401);
  const dashboard=await b.extension('dashboard-state');
  assert.equal(dashboard.status,200);
  assert.equal(dashboard.value.schema_version,'1.0');
  assert.ok(Number.isInteger(dashboard.value.revision));
  assert.equal(dashboard.value.observer.state,'DONE');
  assert.equal(dashboard.value.observer.timeline[0].message,'test');
  assert.ok(dashboard.value.project_tasks && typeof dashboard.value.project_tasks==='object');
  assert.ok(dashboard.value.rdc && typeof dashboard.value.rdc==='object');
  assert.ok(dashboard.value.prepared_dispatch && typeof dashboard.value.prepared_dispatch==='object');
  assert.ok(dashboard.value.executor_policy && typeof dashboard.value.executor_policy==='object');
  const again=await b.extension('dashboard-state');
  assert.equal(again.value.revision,dashboard.value.revision);
});

test('observer snapshot is available only through extension pairing',async t=>{
  const b=await setup(t);
  assert.equal((await b.call('/bridge/observer')).status,401);
  const observer=await b.extension('observer');
  assert.equal(observer.status,200);
  assert.equal(observer.value.state,'DONE');
  assert.equal(observer.value.active_source,'MCP');
  assert.equal(observer.value.timeline[0].message,'test');
});

test('RDC execution intent lifecycle is pairing-protected and capability-bounded',async t=>{
  const b=await setup(t);
  assert.equal((await b.call('/bridge/rdc-intents?adapter=chrome')).status,401);
  const task={task_id:'T-RDC-API',plan_id:'P',goal:'bounded change',scope:{reads:['README.md'],writes:['README.md'],tools:['read','edit','test']},acceptance:[{id:'A1',description:'tests pass'}],budget:{deadline_seconds:90}};
  const {createRdcAdapter}=await import('../server/rdc-adapter.mjs');
  const adapter=createRdcAdapter({repoRoot:new URL('..',import.meta.url).pathname,root:join(b.configDir,'rdc-intents'),observerEventPath:b.observerEventPath});
  const created=await adapter.createIntent({task,conversation_id:'chat-api',turn_id:'turn-api'});
  let state=await b.extension('rdc-intents');
  assert.equal(state.status,200); assert.equal(state.value.latest.intent_id,created.intent_id);
  let step=await b.extension('rdc-intent',{action:'claim',intent_id:created.intent_id,adapter_id:'test-chatgpt',device_id:'dev-1'});
  assert.equal(step.status,200); assert.equal(step.value.status,'CLAIMED');
  step=await b.extension('rdc-intent',{action:'start',intent_id:created.intent_id,device_id:'dev-1'});
  assert.equal(step.status,409); assert.equal(step.value.error,'rdc_approval_required');
  step=await b.extension('rdc-intent',{action:'approval',intent_id:created.intent_id,state:'APPROVED'});
  assert.equal(step.status,200); assert.equal(step.value.approval.state,'APPROVED');
  step=await b.extension('rdc-intent',{action:'start',intent_id:created.intent_id,device_id:'dev-1'});
  assert.equal(step.status,200); assert.equal(step.value.status,'RUNNING');
  step=await b.extension('rdc-intent',{action:'tool',intent_id:created.intent_id,tool:'kill_process',phase:'START'});
  assert.equal(step.status,409); assert.equal(step.value.error,'rdc_capability_denied');
  step=await b.extension('rdc-intent',{action:'tool',intent_id:created.intent_id,tool:'start_process',phase:'START',call_id:'c1'});
  assert.equal(step.status,200);
  step=await b.extension('rdc-intent',{action:'tool',intent_id:created.intent_id,tool:'start_process',phase:'DONE',call_id:'c1',pid:123,duration_ms:20});
  assert.equal(step.status,200);
  step=await b.extension('rdc-intent',{action:'complete',intent_id:created.intent_id,outcome:'PASS',exit_code:0,artifacts:['README.md'],metrics:{elapsed_ms:40}});
  assert.equal(step.status,200); assert.equal(step.value.status,'DONE');
});

test('executor policy is pairing-only, persistent and owner-switchable',async t=>{
  const b=await setup(t);
  assert.equal((await b.call('/bridge/executor-policy')).status,401);
  const initial=await b.extension('executor-policy');
  assert.equal(initial.status,200); assert.equal(initial.value.mode,'AUTO');
  const changed=await b.extension('executor-policy',{mode:'COMPARE'});
  assert.equal(changed.status,200); assert.equal(changed.value.mode,'COMPARE');
  assert.equal((await b.extension('executor-policy')).value.mode,'COMPARE');
  assert.equal((await b.extension('executor-policy',{mode:'MAGIC'})).status,400);
});

test('OAuth and pairing credentials are separate; hostile origin and host are rejected',async t=>{
  const b=await setup(t);
  assert.equal((await b.mcp(b.pairingToken,'tools/list')).status,401);
  assert.match((await b.mcp(null,'tools/list')).headers.get('www-authenticate'),/resource_metadata/);
  assert.equal((await b.call('/bridge/next')).status,401);
  const hostileHost=await new Promise((resolve,reject)=>{const r=http.get(b.issuer+'/health',{headers:{Host:'attacker.example'}},response=>{response.resume();resolve(response.statusCode);});r.on('error',reject);});
  assert.equal(hostileHost,403);
  assert.equal((await b.call('/health',{headers:{Origin:'https://attacker.example'}})).status,403);
  const meta=(await b.call('/.well-known/oauth-protected-resource/mcp')).value; assert.equal(meta.resource,b.resource);
  const client=await b.register(), grant=await b.authorize(client), access=await b.tokenRequest(client,grant);
  assert.equal(access.status,200); assert.equal((await b.call('/bridge/next',{token:access.value.access_token})).status,401);
  const tools=await b.mcp(access.value.access_token,'tools/list'); assert.equal(tools.status,200); assert.deepEqual(tools.value.result.tools.map(x=>x.name),['list_tabs','read_page','find_in_page','bridge_status','local_status','local_list_dir','local_read_file','local_write_file','local_exec_start','local_process_output','local_process_stop']);
  for(const tool of tools.value.result.tools) {assert.deepEqual(tool.securitySchemes,[{type:'oauth2',scopes:['browser.read']}]); assert.deepEqual(tool._meta.securitySchemes,tool.securitySchemes);}
  assert.equal((await stat(join(b.configDir,'clients.json'))).mode & 0o777,0o600);
  assert.equal((await stat(join(b.configDir,'pairing-token'))).mode & 0o777,0o600);
  const persisted=await readFile(join(b.configDir,'clients.json'),'utf8'); assert.ok(!persisted.includes(access.value.access_token)); assert.ok(!persisted.includes(b.pairingToken));
});

test('browser-only MCP resource exposes exactly the four shared-page tools and is audience-bound',async t=>{
  const b=await setup(t), client=await b.register();
  const browserMeta=(await b.call('/.well-known/oauth-protected-resource/mcp/browser')).value;
  assert.equal(browserMeta.resource,b.browserResource);
  const browserGrant=await b.authorize(client,'b'.repeat(43),b.browserResource);
  const browserAccess=(await b.tokenRequest(client,browserGrant)).value.access_token;
  const tools=await b.mcp(browserAccess,'tools/list',{},'/mcp/browser');
  assert.equal(tools.status,200);
  assert.deepEqual(tools.value.result.tools.map(x=>x.name),['list_tabs','read_page','find_in_page','bridge_status']);
  assert.equal((await b.mcp(browserAccess,'tools/list')).status,401);

  const fullGrant=await b.authorize(client,'f'.repeat(43),b.resource);
  const fullAccess=(await b.tokenRequest(client,fullGrant)).value.access_token;
  assert.equal((await b.mcp(fullAccess,'tools/list',{},'/mcp/browser')).status,401);
});

test('Chrome-scoped Desktop MCP cannot be consumed by the Firefox adapter',async t=>{
  const b=await setup(t), client=await b.register();
  const verifier='c'.repeat(43), q=new URLSearchParams({client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),resource:b.browserResource,scope:'browser.read',state:'chrome-only'});
  const page=await b.call('/authorize?'+q);
  const statusPath=JSON.parse(page.value.match(/const statusUrl=("[^"]+")/)[1]);
  const firefoxConsent=(await b.extension('next',undefined,'firefox')).value;
  assert.deepEqual(firefoxConsent.consents,[]);
  const chromeBatch=(await b.extension('next')).value, consent=chromeBatch.consents.find(x=>x.name==='Test MCP Client');
  assert.ok(consent);
  assert.equal((await b.extension('consent',{id:consent.id,allow:true},'firefox')).status,403);
  assert.equal((await b.extension('consent',{id:consent.id,allow:true})).status,200);
  const redirect=new URL((await b.call(statusPath)).value.redirect), code=redirect.searchParams.get('code');
  const access=(await b.call('/token',{method:'POST',data:{grant_type:'authorization_code',client_id:client.client_id,redirect_uri:client.redirect_uris[0],resource:b.browserResource,code,code_verifier:verifier}})).value.access_token;
  const pending=b.mcp(access,'tools/call',{name:'list_tabs',arguments:{}},'/mcp/browser');
  await new Promise(r=>setTimeout(r,10));
  assert.deepEqual((await b.extension('next',undefined,'firefox')).value.commands,[]);
  const command=(await b.extension('next')).value.commands[0]; assert.equal(command.method,'tabs.list');
  assert.match(command.trace.correlation_id,/^corr:/);
  assert.match(command.trace.run_id,/^mcp:corr:/);
  assert.match(command.trace.span_id,/tool:list_tabs$/);
  assert.equal((await b.extension('result',{id:command.id,result:{tabs:[{handle:'chrome-tab'}]}},'firefox')).status,403);
  assert.equal((await b.extension('result',{id:command.id,result:{tabs:[{handle:'chrome-tab'}]}})).status,200);
  const done=await pending; assert.equal(JSON.parse(done.value.result.content[0].text).tabs[0].handle,'chrome-tab');
  const traceLines=(await readFile(b.observerEventPath,'utf8')).trim().split('\n').map(JSON.parse);
  const lifecycle=traceLines.filter(x=>x.meta?.tool==='list_tabs');
  assert.equal(lifecycle.length,2);
  assert.deepEqual(lifecycle.map(x=>x.event),['START','DONE']);
  assert.equal(lifecycle[0].correlation_id,lifecycle[1].correlation_id);
  assert.equal(lifecycle[0].source.source_quality,'transport_observed');
  assert.equal(lifecycle[0].source.turn_id,null);
});


test('browser-observed ChatGPT conversation identity is attached at MCP entry only for a ChatGPT client',async t=>{
  const b=await setup(t);
  const binding={binding:{conversation_id:'chat-real-123',url:'https://chatgpt.com/c/chat-real-123',title:'Acceptance chat',source_quality:'browser_observed',observed_at:new Date().toISOString()}};
  const observed=await b.extension('conversation-active',binding);
  assert.equal(observed.status,200);
  assert.equal(observed.value.binding.conversation_id,'chat-real-123');

  const registerNamed=async name => (await b.call('/register',{method:'POST',data:{client_name:name,redirect_uris:['https://client.example/callback'],token_endpoint_auth_method:'none'}})).value;

  const chat=await registerNamed('ChatGPT');
  const chatGrant=await b.authorize(chat,'q'.repeat(43));
  const chatToken=(await b.tokenRequest(chat,chatGrant)).value.access_token;
  const chatCall=b.mcp(chatToken,'tools/call',{name:'bridge_status',arguments:{}});
  await new Promise(r=>setTimeout(r,10));
  const chatCommand=(await b.extension('next')).value.commands[0];
  assert.equal(chatCommand.method,'bridge.status');
  await b.extension('result',{id:chatCommand.id,result:{connected:true,sharedTabs:0,mode:'read-only'}});
  await chatCall;

  const other=await registerNamed('OpenCode');
  const otherGrant=await b.authorize(other,'r'.repeat(43));
  const otherToken=(await b.tokenRequest(other,otherGrant)).value.access_token;
  const otherCall=b.mcp(otherToken,'tools/call',{name:'bridge_status',arguments:{}});
  await new Promise(r=>setTimeout(r,10));
  const otherCommand=(await b.extension('next')).value.commands[0];
  await b.extension('result',{id:otherCommand.id,result:{connected:true,sharedTabs:0,mode:'read-only'}});
  await otherCall;

  const lines=(await readFile(b.observerEventPath,'utf8')).trim().split('\n').map(JSON.parse).filter(x=>x.meta?.tool==='bridge_status'&&x.event==='START');
  const chatEvent=lines.find(x=>x.source.client==='ChatGPT');
  const otherEvent=lines.find(x=>x.source.client==='OpenCode');
  assert.equal(chatEvent.source.conversation_id,'chat-real-123');
  assert.equal(chatEvent.source.locator,'https://chatgpt.com/c/chat-real-123');
  assert.equal(chatEvent.source.source_quality,'browser_observed');
  assert.equal(otherEvent.source.conversation_id,null);
  assert.equal(otherEvent.source.source_quality,'transport_observed');
});


test('browser-observed turn lifecycle persists an active lease and closes it on DONE',async t=>{
  const b=await setup(t);
  const base={
    conversation_id:'chat-real-123',
    turn_id:'browser:chat-real-123:12345678-1234-1234-1234-123456789abc',
    url:'https://chatgpt.com/c/chat-real-123',
    title:'Acceptance chat',
    observed_at:new Date().toISOString(),
    user_count:1,
    assistant_count:1
  };
  const start=await b.extension('turn-observed',{...base,phase:'START',reason:'composer-submit'});
  assert.equal(start.status,200);
  assert.equal(start.value.phase,'START');
  let state=JSON.parse(await readFile(b.browserTurnStatePath,'utf8'));
  assert.equal(state.active.length,1);
  assert.equal(state.active[0].conversation_id,'chat-real-123');

  const active=await b.extension('turn-observed',{...base,phase:'ACTIVE',reason:'generating-control-present'});
  assert.equal(active.status,200);
  const heartbeat=await b.extension('turn-observed',{...base,phase:'HEARTBEAT'});
  assert.equal(heartbeat.status,200);

  const done=await b.extension('turn-observed',{...base,phase:'DONE',reason:'generating-control-cleared'});
  assert.equal(done.status,200);
  state=JSON.parse(await readFile(b.browserTurnStatePath,'utf8'));
  assert.deepEqual(state.active,[]);

  const lines=(await readFile(b.observerEventPath,'utf8')).trim().split('\n').map(JSON.parse);
  const lifecycle=lines.filter(x=>x.source?.turn_id===base.turn_id).map(x=>x.event);
  assert.deepEqual(lifecycle,['TURN_START','TURN_ACTIVE','TURN_DONE']);
});

test('browser recovery START aliases to the still-leased canonical turn instead of splitting lifecycle',async t=>{
  const b=await setup(t);
  const conversation_id='chat-reload-123';
  const first='browser:chat-reload-123:11111111-1111-1111-1111-111111111111';
  const recovered='browser:chat-reload-123:22222222-2222-2222-2222-222222222222';
  const common={conversation_id,url:'https://chatgpt.com/c/chat-reload-123',title:'Reload chat',observed_at:new Date().toISOString(),user_count:1,assistant_count:1};
  assert.equal((await b.extension('turn-observed',{...common,turn_id:first,phase:'START',reason:'composer-submit'})).status,200);
  assert.equal((await b.extension('turn-observed',{...common,turn_id:first,phase:'ACTIVE',reason:'generating-control-present'})).status,200);
  const recovery=await b.extension('turn-observed',{...common,turn_id:recovered,phase:'START',reason:'attached-during-generation'});
  assert.equal(recovery.status,200);
  assert.equal(recovery.value.turn_id,first);
  assert.equal(recovery.value.observed_turn_id,recovered);
  assert.equal(recovery.value.recovered,true);
  const done=await b.extension('turn-observed',{...common,turn_id:recovered,phase:'DONE',reason:'completed-response-actions-stable',usage_estimate:{schema_version:'1.0',provider:'chatgpt-web',input_tokens:{value:10,quality:'estimated',source:'observable_browser_text',estimator:'utf8-bytes-per-token-v1'}}});
  assert.equal(done.status,200);
  assert.equal(done.value.turn_id,first);
  const lines=(await readFile(b.observerEventPath,'utf8')).trim().split('\n').map(JSON.parse).filter(x=>x.source?.conversation_id===conversation_id);
  assert.deepEqual(lines.map(x=>x.event),['TURN_START','TURN_ACTIVE','TURN_DONE']);
  assert.ok(lines.every(x=>x.source.turn_id===first));
  assert.equal(lines.at(-1).meta.usage_estimate.input_tokens.value,10);
});

test('dev reload revision is monotonic and visible to the extension poll',async t=>{
  const b=await setup(t);
  const before=(await b.extension('next')).value.reload_revision;
  assert.equal(typeof before,'number');
  const trigger=await b.call('/dev/reload-extension',{method:'POST'});
  assert.equal(trigger.status,200);
  assert.ok(trigger.value.reload_revision>before);
  const after=(await b.extension('next')).value.reload_revision;
  assert.equal(after,trigger.value.reload_revision);
});


test('observer snapshot reports disk extension semver without forcing reload',async t=>{
  const b=await setup(t);
  const snapshot=await b.extension('observer');
  assert.equal(snapshot.status,200);
  assert.equal(snapshot.value.extension_version.disk,'0.1.47');
});

test('OpenCode-style DCR metadata is accepted without advertising unsupported refresh grants',async t=>{
  const b=await setup(t);
  const discovery=await b.call('/.well-known/oauth-authorization-server');
  assert.deepEqual(discovery.value.grant_types_supported,['authorization_code']);
  const openCode=await b.call('/register',{method:'POST',data:{
    client_name:'OpenCode',
    client_uri:'https://opencode.ai',
    redirect_uris:['http://127.0.0.1:19876/mcp/oauth/callback'],
    grant_types:['authorization_code','refresh_token'],
    response_types:['code'],
    token_endpoint_auth_method:'none'
  }});
  assert.equal(openCode.status,201);
  assert.deepEqual(openCode.value.grant_types,['authorization_code']);
  assert.deepEqual(openCode.value.response_types,['code']);
  assert.equal((await b.call('/register',{method:'POST',data:{redirect_uris:['http://127.0.0.1:19876/mcp/oauth/callback'],grant_types:['refresh_token'],token_endpoint_auth_method:'none'}})).status,400);
  assert.equal((await b.call('/register',{method:'POST',data:{redirect_uris:['http://127.0.0.1:19876/mcp/oauth/callback'],grant_types:['authorization_code','client_credentials'],token_endpoint_auth_method:'none'}})).status,400);
});

test('PKCE S256, single use codes, audience and extension-only consent',async t=>{
  const b=await setup(t), client=await b.register(), grant=await b.authorize(client);
  assert.equal((await b.tokenRequest(client,grant,{code_verifier:'x'.repeat(43)})).status,400);
  assert.equal((await b.tokenRequest(client,grant)).status,400);
  const wrongAudience=await b.authorize(client); assert.equal((await b.tokenRequest(client,wrongAudience,{resource:'https://attacker.example/mcp'})).status,400);
  const good=await b.authorize(client), result=await b.tokenRequest(client,good); assert.equal(result.status,200);
  assert.equal((await b.tokenRequest(client,good)).status,400);
  assert.equal((await b.call('/bridge/consent',{method:'POST',data:{id:'fake',allow:true},token:result.value.access_token})).status,401);
  assert.equal((await b.call('/register',{method:'POST',data:{redirect_uris:['javascript:alert(1)']}})).status,400);
  assert.equal((await b.call('/register',{method:'POST',data:{redirect_uris:['https://client.example/callback'],token_endpoint_auth_method:'client_secret_basic'}})).status,400);
});

test('commands route to extension; client revocation cancels in-flight data and late results',async t=>{
  const b=await setup(t), client=await b.register(), grant=await b.authorize(client), access=(await b.tokenRequest(client,grant)).value.access_token;
  const response=b.mcp(access,'tools/call',{name:'read_page',arguments:{handle:'shared-handle',maxChars:1000}});
  let command;
  for(let i=0;i<30&&!command;i++){await new Promise(r=>setTimeout(r,5)); command=(await b.extension('next')).value.commands[0];}
  assert.equal(command.method,'page.read'); assert.equal(command.args.handle,'shared-handle');
  await b.extension('result',{id:command.id,result:{text:'Public test text',handle:'shared-handle'}});
  const done=await response; assert.equal(JSON.parse(done.value.result.content[0].text).text,'Public test text');
  const pending=b.mcp(access,'tools/call',{name:'list_tabs',arguments:{}}); let revokedCommand;
  for(let i=0;i<30&&!revokedCommand;i++){await new Promise(r=>setTimeout(r,5)); revokedCommand=(await b.extension('next')).value.commands[0];}
  assert.ok(revokedCommand);
  await b.extension('revoke-client',{id:client.client_id});
  const canceled=await pending; assert.equal(canceled.value.result.isError,true); assert.match(canceled.value.result.content[0].text,/revoked/);
  assert.equal((await b.extension('result',{id:revokedCommand.id,result:{text:'SECRET LATE RESULT'}})).value.discarded,true);
  assert.equal((await b.mcp(access,'tools/list')).status,401);
});

test('deny consent and disconnect revoke access; registrations survive restart',async t=>{
  const b=await setup(t), client=await b.register(), grant=await b.authorize(client), access=(await b.tokenRequest(client,grant)).value.access_token;
  await b.extension('disconnect',{}); assert.equal((await b.mcp(access,'tools/list')).status,401);
  await b.close();
  const restarted=await createBridgeServer({port:0,configDir:b.configDir,observerEventPath:b.observerEventPath,browserTurnStatePath:b.browserTurnStatePath}); t.after(()=>restarted.close());
  assert.equal(restarted.pairingToken,b.pairingToken);
  const issuer=restarted.issuer;
  const q=new URLSearchParams({client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',code_challenge_method:'S256',code_challenge:createHash('sha256').update('v'.repeat(43)).digest('base64url'),resource:restarted.resource,scope:'browser.read'});
  const page=await (await fetch(issuer+'/authorize?'+q)).text(); const statusPath=JSON.parse(page.match(/const statusUrl=("[^"]+")/)[1]);
  const batch=await (await fetch(issuer+'/bridge/next?adapter=chrome',{headers:{Authorization:'Bearer '+restarted.pairingToken}})).json();
  await fetch(issuer+'/bridge/consent?adapter=chrome',{method:'POST',headers:{Authorization:'Bearer '+restarted.pairingToken,'Content-Type':'application/json'},body:JSON.stringify({id:batch.consents[0].id,allow:false})});
  const denied=await (await fetch(issuer+statusPath)).json(); assert.equal(new URL(denied.redirect).searchParams.get('error'),'access_denied');
});


test('observer snapshot exposes running gateway identity separately from repo HEAD',async t=>{
  const b=await setup(t);
  const snapshot=await b.extension('observer');
  assert.equal(snapshot.status,200);
  assert.equal(typeof snapshot.value.gateway_version,'object');
  assert.match(snapshot.value.gateway_version.runtime_commit,/^[0-9a-f]{40}$/);
  assert.match(snapshot.value.gateway_version.repo_head,/^[0-9a-f]{40}$/);
  assert.match(snapshot.value.gateway_version.runtime_server_hash,/^[0-9a-f]{64}$/);
  assert.match(snapshot.value.gateway_version.disk_server_hash,/^[0-9a-f]{64}$/);
  assert.equal(snapshot.value.gateway_version.restart_required,false);
  assert.equal(snapshot.value.gateway_version.repo_changed,false);
});


test('browser turn lease is unique per conversation and heartbeat recovers lost gateway state',async t=>{
  const b=await setup(t);
  const base={
    conversation_id:'chat-real-123',
    url:'https://chatgpt.com/c/chat-real-123',
    title:'Recovery chat',
    observed_at:new Date().toISOString(),
    user_count:0,
    assistant_count:0
  };
  const turn1='browser:chat-real-123:11111111-1111-1111-1111-111111111111';
  const turn2='browser:chat-real-123:22222222-2222-2222-2222-222222222222';
  assert.equal((await b.extension('turn-observed',{...base,turn_id:turn1,phase:'START'})).status,200);
  assert.equal((await b.extension('turn-observed',{...base,turn_id:turn2,phase:'START'})).status,200);
  let state=JSON.parse(await readFile(b.browserTurnStatePath,'utf8'));
  assert.equal(state.active.length,1);
  assert.equal(state.active[0].turn_id,turn2);

  assert.equal((await b.extension('turn-observed',{...base,turn_id:turn2,phase:'DONE'})).status,200);
  state=JSON.parse(await readFile(b.browserTurnStatePath,'utf8'));
  assert.deepEqual(state.active,[]);

  const recovered=await b.extension('turn-observed',{...base,turn_id:turn2,phase:'HEARTBEAT'});
  assert.equal(recovered.status,200);
  assert.equal(recovered.value.recovered,true);
  state=JSON.parse(await readFile(b.browserTurnStatePath,'utf8'));
  assert.equal(state.active.length,1);
  assert.equal(state.active[0].turn_id,turn2);
});



test('observer snapshot exposes active browser CHAT turn independently of external actors',async t=>{
  const b=await setup(t);
  const now=new Date().toISOString();
  const binding={binding:{conversation_id:'chat-turn-actor-123',url:'https://chatgpt.com/c/chat-turn-actor-123',title:'Actor chat',source_quality:'browser_observed',observed_at:now}};
  assert.equal((await b.extension('conversation-active',binding)).status,200);
  assert.equal((await b.extension('chat-detector-status',{detector_version:'turn-v5',conversation_id:'chat-turn-actor-123',url:'https://chatgpt.com/c/chat-turn-actor-123',title:'Actor chat',observed_at:now,user_count:1,assistant_count:1,generating:true,activity_state:'active',waiting_user:false,active_turn_id:'turn:chat-turn-actor-123:1234567890',structural_counts:{},tab_id:42})).status,200);
  assert.equal((await b.extension('turn-observed',{phase:'START',conversation_id:'chat-turn-actor-123',turn_id:'turn:chat-turn-actor-123:1234567890',url:'https://chatgpt.com/c/chat-turn-actor-123',title:'Actor chat',observed_at:now})).status,200);
  const snapshot=await b.extension('observer');
  assert.equal(snapshot.status,200);
  assert.equal(snapshot.value.chat_activity.state,'active');
  assert.equal(snapshot.value.chat_activity.active,true);
  assert.equal(snapshot.value.chat_activity.waiting_user,false);
  assert.equal(snapshot.value.chat_activity.pending,false);
  assert.equal(snapshot.value.chat_activity.conversation_id,'chat-turn-actor-123');
  assert.equal(snapshot.value.chat_activity.turn_id,'turn:chat-turn-actor-123:1234567890');
  assert.equal(snapshot.value.chat_activity.source_quality,'browser_observed');
});


test('observer snapshot does not infer CHAT active from an open browser turn',async t=>{
  const b=await setup(t);
  const now=new Date().toISOString();
  const conversation_id='chat-turn-pending-123';
  const turn_id='turn:chat-turn-pending-123:1234567890';
  const url='https://chatgpt.com/c/'+conversation_id;
  assert.equal((await b.extension('conversation-active',{binding:{conversation_id,url,title:'Pending chat',source_quality:'browser_observed',observed_at:now}})).status,200);
  assert.equal((await b.extension('turn-observed',{phase:'START',conversation_id,turn_id,url,title:'Pending chat',observed_at:now})).status,200);
  assert.equal((await b.extension('chat-detector-status',{detector_version:'turn-v5',conversation_id,url,title:'Pending chat',observed_at:now,user_count:1,assistant_count:1,generating:false,activity_state:'pending',waiting_user:false,active_turn_id:turn_id,structural_counts:{},tab_id:43})).status,200);
  const snapshot=await b.extension('observer');
  assert.equal(snapshot.status,200);
  assert.equal(snapshot.value.chat_activity.state,'pending');
  assert.equal(snapshot.value.chat_activity.active,false);
  assert.equal(snapshot.value.chat_activity.pending,true);
  assert.equal(snapshot.value.chat_activity.turn_id,turn_id);
});

test('chat detector diagnostics preserve waiting_user state end to end',async t=>{
  const b=await setup(t);
  const now=new Date().toISOString();
  const conversation_id='chat-turn-waiting-123';
  const turn_id='turn:chat-turn-waiting-123:1234567890';
  const url='https://chatgpt.com/c/'+conversation_id;
  assert.equal((await b.extension('conversation-active',{binding:{conversation_id,url,title:'Waiting chat',source_quality:'browser_observed',observed_at:now}})).status,200);
  assert.equal((await b.extension('chat-detector-status',{detector_version:'turn-v5',conversation_id,url,title:'Waiting chat',observed_at:now,user_count:1,assistant_count:1,generating:false,activity_state:'waiting_user',waiting_user:true,active_turn_id:turn_id,structural_counts:{dialog:1},tab_id:44})).status,200);
  const detectors=await fetch(b.issuer+'/dev/chat-detectors').then(r=>r.json());
  const detector=detectors.detectors.find(x=>x.conversation_id===conversation_id);
  assert.equal(detector.activity_state,'waiting_user');
  assert.equal(detector.waiting_user,true);
  const snapshot=await b.extension('observer');
  assert.equal(snapshot.value.chat_activity.state,'waiting_user');
  assert.equal(snapshot.value.chat_activity.active,false);
  assert.equal(snapshot.value.chat_activity.waiting_user,true);
});
