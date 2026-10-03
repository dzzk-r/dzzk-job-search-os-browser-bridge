import {Builder,By,until} from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createBridgeServer} from '../server/index.mjs';

// Disposable profile only. The privileged driver triggers the real action grant,
// then exercises packaged UI messages and scripting through the MCP companion.
const directory=await mkdtemp(path.join(tmpdir(),'dzzk-firefox-smoke-'));
const bridge=await createBridgeServer({configDir:directory});
const fixture=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Platform Engineer — Test</title><h1>Platform Engineer</h1><p>Office cadence: one day per week.</p><p>Recruiter: please bring the working endpoint.</p><p hidden>HIDDEN SECRET</p><textarea>DRAFT SECRET</textarea><input value="PASSWORD SECRET"><div contenteditable="true">EDITABLE SECRET</div>');});
await new Promise(r=>fixture.listen(43333,'127.0.0.1',r));
let driver,gecko;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const call=async(p,data,token)=>{
 const r=await fetch(bridge.issuer+p,{method:data?'POST':'GET',headers:{...(data?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(data?{body:JSON.stringify(data)}:{})});
 const raw=await r.text();return {status:r.status,value:raw.startsWith('{')?JSON.parse(raw):raw};
};
const mcp=async(token,name,args={})=>{
 const r=await fetch(bridge.resource,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});
 const x=await r.json();assert.equal(r.status,200);return x.result;
};
try {
 const binary=process.env.FIREFOX_BIN;
 const options=new firefox.Options().addArguments('-headless');
 if(binary) options.setBinary(binary);
 let builder=new Builder().forBrowser('firefox').setFirefoxOptions(options);
 if(process.env.GECKODRIVER_BIN) {
  gecko=spawn(process.env.GECKODRIVER_BIN,['--host','127.0.0.1','--port','4444','--allow-system-access'],{stdio:['ignore','ignore','inherit']});
  await wait(500);builder=builder.usingServer('http://127.0.0.1:4444');
 } else {
  builder=builder.setFirefoxService(new firefox.ServiceBuilder().addArguments('--allow-system-access'));
 }
 driver=await builder.build();await driver.manage().setTimeouts({implicit:5000,script:15000});
 await driver.installAddon(path.resolve('dist/dzzk_job_search_os_browser_bridge-0.1.1.zip'),true);await wait(1200);
 await driver.setContext('chrome');
 const uuid=await driver.executeScript("return JSON.parse(Services.prefs.getCharPref('extensions.webextensions.uuids'))['browser-bridge@dzzk.dev']");
 const base='moz-extension://'+uuid+'/';await driver.setContext('content');
 await driver.get(base+'options.html');await driver.findElement(By.id('token')).sendKeys(bridge.pairingToken);
 await driver.findElement(By.id('consent')).click();await driver.findElement(By.css('button[type=submit]')).click();
 await driver.wait(until.elementTextContains(driver.findElement(By.id('message')),'Configured'),5000);
 await driver.get(base+'popup.html');await driver.wait(until.elementTextIs(driver.findElement(By.id('status')),'Connected'),10000);
 const registration=(await call('/register',{client_name:'Firefox smoke test',redirect_uris:['https://client.example/callback'],token_endpoint_auth_method:'none'})).value;
 const verifier='v'.repeat(43), q=new URLSearchParams({client_id:registration.client_id,redirect_uri:registration.redirect_uris[0],response_type:'code',code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url'),resource:bridge.resource,scope:'browser.read'});
 const authorization=(await call('/authorize?'+q)).value;
 const statusPath=JSON.parse(authorization.match(/const statusUrl=("[^"]+")/)[1]);
 await driver.wait(until.elementLocated(By.css('#consents button')),6000);await driver.findElement(By.css('#consents button')).click();
 const approved=(await call(statusPath)).value;
 const code=new URL(approved.redirect).searchParams.get('code');assert.ok(code);
 const token=(await call('/token',{grant_type:'authorization_code',client_id:registration.client_id,redirect_uri:registration.redirect_uris[0],resource:bridge.resource,code,code_verifier:verifier})).value.access_token;assert.ok(token);
 let result=await mcp(token,'list_tabs');assert.deepEqual(JSON.parse(result.content[0].text).tabs,[]);
 const page='http://localhost:43333/';await driver.get(page);await driver.setContext('chrome');
 await driver.executeScript("const p=WebExtensionPolicy.getByID('browser-bridge@dzzk.dev');ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs').ExtensionParent.apiManager.global.browserActionFor(p.extension).triggerAction(window);");
 await wait(300);
 await driver.executeScript("for(const p of document.querySelectorAll('panel'))if(p.state==='open')p.hidePopup();");
 await driver.setContext('content');await driver.switchTo().newWindow('tab');await driver.get(base+'popup.html');
 const handle=await driver.executeAsyncScript(`const done=arguments[arguments.length-1]; browser.tabs.query({}).then(async tabs=>{const target=tabs.find(t=>t.url===arguments[0]);if(!target)throw new Error('Granted fixture tab not found');await browser.tabs.update(target.id,{active:true});const r=await browser.runtime.sendMessage({type:'share',tabId:target.id});done(r.handle)}).catch(e=>done({error:e.message}));`,page);
 assert.equal(typeof handle,'string',JSON.stringify(handle));
 result=await mcp(token,'read_page',{handle});assert.ok(!result.isError,JSON.stringify(result));
 const evidence=JSON.parse(result.content[0].text);assert.match(evidence.text,/one day per week/);assert.doesNotMatch(evidence.text,/SECRET/);assert.equal(evidence.url,page);
 result=await mcp(token,'find_in_page',{handle,query:'working endpoint'});assert.equal(JSON.parse(result.content[0].text).matches.length,1);
 const current=await driver.getAllWindowHandles();
 for(const h of current){await driver.switchTo().window(h);if((await driver.getCurrentUrl())===base+'popup.html')break;}
 const choose=async(mode)=>{
  await driver.wait(until.elementLocated(By.css('select[data-method="page.read"]')),6000);
  await driver.findElement(By.css(`select[data-method="page.read"] option[value="${mode}"]`)).click();
  await driver.wait(async()=>{
   const batch=(await call('/bridge/next',undefined,bridge.pairingToken)).value;
   return batch.clients[0]?.permissions['page.read']===mode;
  },6000);
 };
 await choose('ask');
 let pending=mcp(token,'read_page',{handle});
 await driver.wait(until.elementLocated(By.css('#actions button')),6000);
 await driver.findElement(By.css('#actions button')).click();
 result=await pending;assert.ok(!result.isError,JSON.stringify(result));
 await driver.wait(async()=>await driver.findElements(By.css('#actions button')).then(x=>x.length===0),6000);
 pending=mcp(token,'read_page',{handle});
 await driver.wait(until.elementLocated(By.css('#actions button')),6000);
 await driver.findElement(By.css('#actions button:nth-of-type(2)')).click();
 result=await pending;assert.equal(result.isError,true);assert.match(result.content[0].text,/denied/i);
 await choose('block');result=await mcp(token,'read_page',{handle});assert.equal(result.isError,true);assert.match(result.content[0].text,/blocked/i);
 await choose('allow');result=await mcp(token,'read_page',{handle});assert.ok(!result.isError);
 await driver.findElement(By.id('pause')).click();
 await driver.wait(until.elementTextIs(driver.findElement(By.id('status')),'Paused'),6000);
 result=await mcp(token,'read_page',{handle});assert.equal(result.isError,true);assert.match(result.content[0].text,/paused/i);
 await driver.wait(async()=>await driver.findElements(By.css('#grants .card')).then(x=>x.length===0),6000);
 await mkdir('artifacts',{recursive:true});
 await writeFile('artifacts/firefox-paused.png',Buffer.from(await driver.takeScreenshot(),'base64'));
 await driver.findElement(By.id('pause')).click();
 await driver.wait(until.elementTextIs(driver.findElement(By.id('status')),'Connected'),6000);
 result=await mcp(token,'read_page',{handle});assert.equal(result.isError,true);assert.match(result.content[0].text,/not shared|expired/i);
 await mkdir('artifacts',{recursive:true});
 await writeFile('artifacts/firefox-popup.png',Buffer.from(await driver.takeScreenshot(),'base64'));
 await writeFile('artifacts/firefox-smoke.json',JSON.stringify({firefox:(await driver.getCapabilities()).get('browserVersion'),checks:['installed','configured','OAuth popup approval','unshared tabs excluded','read visible fixture','hidden/forms/drafts excluded','find passage','ask approval once','denial once','method block','global pause','resume does not restore grants'],fixture:page,passed:true},null,2)+'\n');
 console.log('PASS: real Firefox install → configure → OAuth approve → share → MCP read/find → ask/deny/block → pause → resume without grants.');
} finally {
 if(driver) await driver.quit().catch(()=>{});gecko?.kill();await bridge.close();fixture.closeAllConnections();await new Promise(r=>fixture.close(r));await rm(directory,{recursive:true,force:true});
}
