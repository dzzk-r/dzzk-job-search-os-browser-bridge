#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';

const port=Number(process.env.EDH_COMPANION_PORT||43119);
const tokenPath=process.env.EDH_PAIRING_TOKEN_FILE||join(homedir(),'.config/dzzk-jso-bridge/pairing-token');
const token=(await readFile(tokenPath,'utf8')).trim();
const [action,...rest]=process.argv.slice(2);
function usage(){
  console.error('usage: node scripts/rdc-intent-client.mjs <list|claim|approve|deny|start|heartbeat|tool|complete> [args]');
  process.exit(2);
}
async function request(path,method='GET',data=null){
  const r=await fetch(`http://127.0.0.1:${port}/bridge/${path}${path.includes('?')?'&':'?'}adapter=chrome`,{
    method,headers:{Authorization:'Bearer '+token,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined
  });
  const text=await r.text(); let value; try{value=JSON.parse(text);}catch{value=text;}
  if(!r.ok){console.error(JSON.stringify(value));process.exit(1);} return value;
}
let result;
if(action==='list') result=await request('rdc-intents');
else if(action==='claim') {const [intent_id,device_id]=rest;if(!intent_id) usage();result=await request('rdc-intent','POST',{action:'claim',intent_id,adapter_id:'chatgpt-rdc-adapter',device_id:device_id||null});}
else if(action==='approve'||action==='deny') {const [intent_id]=rest;if(!intent_id) usage();result=await request('rdc-intent','POST',{action:'approval',intent_id,state:action==='approve'?'APPROVED':'DENIED'});}
else if(action==='start') {const [intent_id,device_id]=rest;if(!intent_id) usage();result=await request('rdc-intent','POST',{action:'start',intent_id,adapter_id:'chatgpt-rdc-adapter',device_id:device_id||null});}
else if(action==='heartbeat') {const [intent_id]=rest;if(!intent_id) usage();result=await request('rdc-intent','POST',{action:'heartbeat',intent_id});}
else if(action==='tool') {
  const [intent_id,tool,phase,call_id,pid,duration_ms]=rest;if(!intent_id||!tool||!phase) usage();
  result=await request('rdc-intent','POST',{action:'tool',intent_id,tool,phase,call_id:call_id||null,pid:pid?Number(pid):null,duration_ms:duration_ms?Number(duration_ms):null});
}
else if(action==='complete') {
  const [intent_id,outcome='PASS',exit_code='0',...artifacts]=rest;if(!intent_id) usage();
  result=await request('rdc-intent','POST',{action:'complete',intent_id,outcome,exit_code:Number(exit_code),artifacts,metrics:{reported_by:'chatgpt-rdc-adapter'}});
} else usage();
console.log(JSON.stringify(result,null,2));
