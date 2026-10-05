import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBridgeServer} from '../server/index.mjs';

async function setup(t) {
  const configDir=await mkdtemp(join(tmpdir(),'dzzk-policy-test-')), instances=[];
  let bridge=await createBridgeServer({port:0,configDir}); instances.push(bridge);
  t.after(async()=>{for(const instance of instances)await instance.close();await rm(configDir,{recursive:true,force:true});});
  const call=async(path,data,token)=>{
    const response=await fetch(bridge.issuer+path,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(data?{body:JSON.stringify(data)}:{})});
    const raw=await response.text();let value;try{value=JSON.parse(raw);}catch{value=raw;}return {status:response.status,value};
  };
  const extension=(path,data,adapter='chrome')=>call('/bridge/'+path+'?adapter='+adapter,data,bridge.pairingToken);
  const authorize=async client=>{
    const verifier='v'.repeat(43), q=new URLSearchParams({client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),resource:bridge.resource,scope:'browser.read'});
    const page=await call('/authorize?'+q);assert.equal(page.status,200);
    const statusPath=JSON.parse(page.value.match(/const statusUrl=("[^"]+")/)[1]), batch=(await extension('next')).value;
    await extension('consent',{id:batch.consents[0].id,allow:true});
    const redirect=new URL((await call(statusPath)).value.redirect);
    const result=await call('/token',{grant_type:'authorization_code',client_id:client.client_id,redirect_uri:client.redirect_uris[0],resource:bridge.resource,code:redirect.searchParams.get('code'),code_verifier:verifier});assert.equal(result.status,200);return result.value.access_token;
  };
  const register=async()=> (await call('/register',{client_name:'Policy Client',redirect_uris:['https://client.example/callback']})).value;
  // MCP requests require both response content types.
  const toolCall=async(access,name,args={})=>{
    const response=await fetch(bridge.resource,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:'Bearer '+access},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
    return {status:response.status,value:await response.json()};
  };
  const waitBatch=async predicate=>{for(let i=0;i<50;i++){const batch=(await extension('next')).value;if(predicate(batch))return batch;await new Promise(r=>setTimeout(r,5));}assert.fail('Command or action did not arrive.');};
  const restart=async()=>{await bridge.close();bridge=await createBridgeServer({port:0,configDir});instances.push(bridge);};
  const client=await register(),access=await authorize(client);
  return {client,access,extension,call,authorize,tool:toolCall,waitBatch,restart,configDir};
}

test('global pause cancels in-flight returns, discards late data, and never restores canceled calls',async t=>{
  const b=await setup(t), pending=b.tool(b.access,'read_page',{handle:'page-one'});
  const command=(await b.waitBatch(x=>x.commands.length)).commands[0];
  assert.equal((await b.extension('policy',{paused:true})).status,200);
  const canceled=await pending;assert.equal(canceled.value.result.isError,true);assert.match(canceled.value.result.content[0].text,/canceled/);
  assert.equal((await b.extension('result',{id:command.id,result:{text:'LATE SECRET'}})).value.discarded,true);
  assert.equal((await b.tool(b.access,'list_tabs')).value.result.isError,true);
  assert.equal((await b.extension('next')).value.policy.paused,true);
  await b.extension('policy',{paused:false});assert.deepEqual((await b.extension('next')).value.commands,[]);
  const resumed=b.tool(b.access,'bridge_status');const next=(await b.waitBatch(x=>x.commands.length)).commands[0];
  await b.extension('result',{id:next.id,result:{connected:true}});assert.equal((await resumed).value.result.isError,undefined);
});

test('method block survives disconnect, restart and OAuth reauthorization; remote cannot change policy',async t=>{
  const b=await setup(t);
  const setting={clientId:b.client.client_id,method:'page.read',mode:'block'};
  assert.equal((await b.call('/bridge/policy',setting,b.access)).status,401);
  assert.equal((await b.extension('policy',{...setting,paused:false})).status,400);
  assert.equal((await b.extension('policy',{...setting,method:'page.click'})).status,400);
  assert.equal((await b.extension('policy',setting)).status,200);
  const snapshot=(await b.extension('next')).value;assert.equal(snapshot.clients[0].permissions['page.read'],'block');
  assert.equal((await b.tool(b.access,'read_page',{handle:'page-one'})).value.result.isError,true);
  await b.extension('disconnect',{});await b.restart();const access=await b.authorize(b.client);
  assert.equal((await b.tool(access,'read_page',{handle:'page-one'})).value.result.isError,true);
  assert.equal((await b.extension('next')).value.clients[0].permissions['page.read'],'block');
  assert.equal((await stat(join(b.configDir,'policy.json'))).mode&0o777,0o600);
});

test('local executor tools are blocked by default and require explicit per-client enablement',async t=>{
  const b=await setup(t);
  const blocked=await b.tool(b.access,'local_status');
  assert.equal(blocked.value.result.isError,true);
  assert.match(blocked.value.result.content[0].text,/blocked/);
  const snapshot=(await b.extension('next')).value;
  assert.equal(snapshot.clients[0].permissions['local.status'],'block');
  assert.equal((await b.extension('policy',{clientId:b.client.client_id,method:'local.status',mode:'allow'})).status,200);
  const allowed=await b.tool(b.access,'local_status');
  assert.equal(allowed.value.result.isError,undefined);
  const data=JSON.parse(allowed.value.result.content[0].text);
  assert.equal(data.execMode,'trusted-shell');
  assert.ok(Array.isArray(data.allowedRoots));
});

test('ask withholds command until one-use manual approval; deny does not suppress the next prompt',async t=>{
  const b=await setup(t);await b.extension('policy',{clientId:b.client.client_id,method:'page.read',mode:'ask'});
  const pending=b.tool(b.access,'read_page',{handle:'page-one'}), batch=await b.waitBatch(x=>x.actions.length), action=batch.actions[0];
  assert.deepEqual(batch.commands,[]);assert.equal(action.clientName,'Policy Client');assert.equal(action.target,'page-one');
  assert.equal((await b.call('/bridge/action-consent',{id:action.id,allow:true},b.access)).status,401);
  assert.equal((await b.extension('action-consent',{id:action.id,allow:true})).status,200);
  assert.equal((await b.extension('action-consent',{id:action.id,allow:true})).status,400);
  const command=(await b.waitBatch(x=>x.commands.length)).commands[0];assert.equal(command.id,action.id);
  await b.extension('result',{id:command.id,result:{text:'Allowed exactly once'}});assert.equal((await pending).value.result.isError,undefined);
  const denied=b.tool(b.access,'read_page',{handle:'page-one'}), second=(await b.waitBatch(x=>x.actions.length)).actions[0];assert.notEqual(second.id,action.id);
  await b.extension('action-consent',{id:second.id,allow:false});assert.match((await denied).value.result.content[0].text,/denied/);
  const again=b.tool(b.access,'read_page',{handle:'page-one'}), third=(await b.waitBatch(x=>x.actions.length)).actions[0];assert.notEqual(third.id,second.id);
  await b.extension('action-consent',{id:third.id,allow:false});assert.equal((await again).value.result.isError,true);
});

test('permission change cancels outstanding manual approval; paused state survives restart',async t=>{
  const b=await setup(t);await b.extension('policy',{clientId:b.client.client_id,method:'tabs.list',mode:'ask'});
  const pending=b.tool(b.access,'list_tabs'), action=(await b.waitBatch(x=>x.actions.length)).actions[0];
  await b.extension('policy',{clientId:b.client.client_id,method:'tabs.list',mode:'block'});
  assert.equal((await pending).value.result.isError,true);assert.equal((await b.extension('action-consent',{id:action.id,allow:true})).status,400);
  await b.extension('policy',{paused:true});await b.restart();assert.equal((await b.extension('next')).value.policy.paused,true);
  const q=new URLSearchParams({client_id:b.client.client_id,redirect_uri:b.client.redirect_uris[0],response_type:'code'});
  assert.equal((await b.call('/authorize?'+q)).status,403);
});

test('pause denies a pending OAuth authorization and prevents approving its old consent',async t=>{
  const b=await setup(t), resource=(await b.call('/.well-known/oauth-protected-resource/mcp')).value.resource;
  const q=new URLSearchParams({client_id:b.client.client_id,redirect_uri:b.client.redirect_uris[0],response_type:'code',code_challenge_method:'S256',code_challenge:createHash('sha256').update('v'.repeat(43)).digest('base64url'),resource,scope:'browser.read'});
  const page=await b.call('/authorize?'+q), statusPath=JSON.parse(page.value.match(/const statusUrl=("[^"]+")/)[1]);
  const consent=(await b.extension('next')).value.consents[0];assert.ok(consent);
  await b.extension('policy',{paused:true});
  assert.equal((await b.extension('consent',{id:consent.id,allow:true})).status,400);
  const result=await b.call(statusPath);assert.equal(new URL(result.value.redirect).searchParams.get('error'),'access_denied');
});
