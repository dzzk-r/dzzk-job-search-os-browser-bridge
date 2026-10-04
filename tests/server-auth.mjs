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
  const bridge=await createBridgeServer({port:0,configDir,observerSnapshot:async()=>({state:'DONE',active_source:'MCP',timeline:[{ts:1,source:'MCP',message:'test'}],versions:{mcp:'test'}})});
  t.after(async()=>{await bridge.close(); await rm(configDir,{recursive:true,force:true});});
  const call=async(path,{method='GET',data,token,headers={}}={})=>{
    const response=await fetch(bridge.issuer+path,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...headers},...(data?{body:JSON.stringify(data)}:{})});
    const text=await response.text(); let value; try{value=JSON.parse(text);}catch{value=text;} return {status:response.status,value,headers:response.headers};
  };
  const extension=(path,data)=>call('/bridge/'+path,{method:data?'POST':'GET',data,token:bridge.pairingToken});
  const register=async()=> (await call('/register',{method:'POST',data:{client_name:'Test MCP Client',redirect_uris:['https://client.example/callback'],token_endpoint_auth_method:'none'}})).value;
  const authorize=async(client,verifier='v'.repeat(43))=>{
    const q=new URLSearchParams({client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),resource:bridge.resource,scope:'browser.read',state:'test-state'});
    const page=await call('/authorize?'+q); assert.equal(page.status,200);
    const statusPath=JSON.parse(page.value.match(/const statusUrl=("[^"]+")/)[1]);
    const consent=(await extension('next')).value.consents.find(x=>x.name==='Test MCP Client'); assert.ok(consent);
    assert.equal((await extension('consent',{id:consent.id,allow:true})).status,200);
    const result=await call(statusPath), redirect=new URL(result.value.redirect); assert.equal(redirect.searchParams.get('state'),'test-state'); assert.equal(redirect.searchParams.get('iss'),bridge.issuer);
    return {code:redirect.searchParams.get('code'),verifier};
  };
  const tokenRequest=(client,grant,changes={})=>call('/token',{method:'POST',data:{grant_type:'authorization_code',client_id:client.client_id,redirect_uri:client.redirect_uris[0],resource:bridge.resource,code:grant.code,code_verifier:grant.verifier,...changes}});
  const mcp=(token,method,params={})=>call('/mcp',{method:'POST',token,data:{jsonrpc:'2.0',id:1,method,params},headers:{Accept:'application/json, text/event-stream'}});
  return {...bridge,configDir,call,extension,register,authorize,tokenRequest,mcp};
}

test('observer snapshot is available only through extension pairing',async t=>{
  const b=await setup(t);
  assert.equal((await b.call('/bridge/observer')).status,401);
  const observer=await b.extension('observer');
  assert.equal(observer.status,200);
  assert.equal(observer.value.state,'DONE');
  assert.equal(observer.value.active_source,'MCP');
  assert.equal(observer.value.timeline[0].message,'test');
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
  const restarted=await createBridgeServer({port:0,configDir:b.configDir}); t.after(()=>restarted.close());
  assert.equal(restarted.pairingToken,b.pairingToken);
  const issuer=restarted.issuer;
  const q=new URLSearchParams({client_id:client.client_id,redirect_uri:client.redirect_uris[0],response_type:'code',code_challenge_method:'S256',code_challenge:createHash('sha256').update('v'.repeat(43)).digest('base64url'),resource:restarted.resource,scope:'browser.read'});
  const page=await (await fetch(issuer+'/authorize?'+q)).text(); const statusPath=JSON.parse(page.match(/const statusUrl=("[^"]+")/)[1]);
  const batch=await (await fetch(issuer+'/bridge/next',{headers:{Authorization:'Bearer '+restarted.pairingToken}})).json();
  await fetch(issuer+'/bridge/consent',{method:'POST',headers:{Authorization:'Bearer '+restarted.pairingToken,'Content-Type':'application/json'},body:JSON.stringify({id:batch.consents[0].id,allow:false})});
  const denied=await (await fetch(issuer+statusPath)).json(); assert.equal(new URL(denied.redirect).searchParams.get('error'),'access_denied');
});
