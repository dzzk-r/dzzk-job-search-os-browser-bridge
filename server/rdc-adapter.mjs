import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { appendObserverEvent, newCorrelationId } from '../scripts/observer-events.mjs';

const TERMINAL=new Set(['DONE','ERROR','CANCELED','DENIED']);
const TOOL_MAP={
  read:['read_file','read_multiple_files','list_directory'],
  inspect:['read_file','read_multiple_files','list_directory'],
  list:['list_directory'],
  edit:['write_file','edit_block','create_directory'],
  write:['write_file','edit_block','create_directory'],
  test:['start_process','read_process_output','force_terminate'],
  exec:['start_process','read_process_output','interact_with_process','force_terminate'],
  shell:['start_process','read_process_output','interact_with_process','force_terminate'],
  process:['start_process','read_process_output','interact_with_process','force_terminate'],
  git:['start_process','read_process_output','force_terminate']
};

async function readJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT') return null; throw e;}}
async function atomicJson(path,value){await mkdir(dirname(path),{recursive:true,mode:0o700});const tmp=path+'.tmp-'+process.pid;await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(tmp,path);}
function slug(id){return String(id).replace(/[^A-Za-z0-9_.-]+/g,'-');}
function now(){return new Date().toISOString();}
function unique(values){return [...new Set(values.filter(Boolean))];}

function capabilitiesFor(task,repoRoot){
  const declared=Array.isArray(task?.scope?.tools)?task.scope.tools.map(x=>String(x).toLowerCase()):[];
  const rdcTools=[];
  for(const item of declared) {
    for(const [key,tools] of Object.entries(TOOL_MAP)) if(item===key || item.includes(key)) rdcTools.push(...tools);
  }
  const reads=Array.isArray(task?.scope?.reads)?task.scope.reads.map(String):[];
  const writes=Array.isArray(task?.scope?.writes)?task.scope.writes.map(String):[];
  return {
    declared_task_tools:declared,
    rdc_tools:unique(rdcTools),
    allowed_roots:[repoRoot],
    declared_reads:reads,
    declared_writes:writes,
    platform_permission_note:'Remote Desktop Commander platform approval may expose a broader local capability than this EDH task contract. The adapter must use only rdc_tools and declared task scope.',
    capability_gap:'platform_permission_can_be_broader_than_edh_intent'
  };
}

export function createRdcAdapter(options={}){
  const repoRoot=resolve(options.repoRoot??process.cwd());
  const root=resolve(options.root??join(homedir(),'.local/state/execution-delivery-harness/rdc-intents'));
  const observerEventPath=options.observerEventPath??null;
  const eventOptions=observerEventPath?{path:observerEventPath}:{};
  const intentPath=id=>join(root,slug(id),'intent.json');
  const eventPath=id=>join(root,slug(id),'events.jsonl');

  async function appendIntentEvent(intent,event,detail={}){
    const value={schema_version:'1.0',ts:now(),intent_id:intent.intent_id,run_id:intent.run_id,correlation_id:intent.correlation_id,event,...detail};
    await mkdir(dirname(eventPath(intent.intent_id)),{recursive:true,mode:0o700});
    await appendFile(eventPath(intent.intent_id),JSON.stringify(value)+'\n');
    return value;
  }

  async function save(value){value.updated_at=now();await atomicJson(intentPath(value.intent_id),value);return value;}
  async function get(intentId){const value=await readJson(intentPath(intentId));if(!value) throw Object.assign(new Error('Unknown RDC intent '+intentId),{code:'rdc_intent_not_found'});return value;}

  async function createIntent({task,baseline_commit=null,source_run_dir=null,conversation_id=null,turn_id=null}={}){
    if(!task||typeof task!=='object'||Array.isArray(task)||typeof task.task_id!=='string'||!task.task_id.trim()) throw Object.assign(new Error('A bounded task envelope with task_id is required for RDC dispatch.'),{code:'invalid_rdc_task'});
    const uuid=randomUUID(), intent_id='rdc:'+uuid, run_id='rdc-run:'+uuid, correlation_id=newCorrelationId();
    const span_id=run_id+':executor';
    const value={
      schema_version:'1.0',intent_id,run_id,correlation_id,span_id,executor:'RDC',status:'AWAITING_CLAIM',
      task_id:task.task_id,plan_id:task.plan_id||null,goal:task.goal||null,baseline_commit,source_run_dir,
      conversation_id,turn_id,acceptance:Array.isArray(task.acceptance)?task.acceptance:[],budget:task.budget||{},scope:task.scope||{},
      capabilities:capabilitiesFor(task,repoRoot),
      approval:{required:true,state:'PENDING_EXTERNAL',authority:'chatgpt-platform-rdc',updated_at:null},
      adapter:null,result:null,metrics:{tool_calls:0,tool_errors:0},created_at:now(),updated_at:null
    };
    await save(value); await appendIntentEvent(value,'INTENT_CREATED',{status:value.status});
    await appendObserverEvent({actor:'RDC',event:'INTENT_CREATED',correlation_id,run_id,plan_id:value.plan_id,task_id:value.task_id,span_id,message:'RDC execution intent created; awaiting external executor claim',source:{client:'EDH Dispatcher',conversation_id,turn_id,action_label:value.goal,locator:'rdc-intent:'+intent_id,source_quality:'declared'},meta:{intent_id,status:value.status,rdc_tools:value.capabilities.rdc_tools,approval:value.approval.state}},eventOptions);
    return value;
  }

  async function list({includeTerminal=true}={}){
    await mkdir(root,{recursive:true,mode:0o700});
    const out=[];
    for(const entry of await readdir(root,{withFileTypes:true})) {
      if(!entry.isDirectory()) continue;
      const value=await readJson(join(root,entry.name,'intent.json'));
      if(value && (includeTerminal || !TERMINAL.has(value.status))) out.push(value);
    }
    return out.sort((a,b)=>Date.parse(b.updated_at||b.created_at||0)-Date.parse(a.updated_at||a.created_at||0));
  }

  async function claim(intentId,{adapter_id='chatgpt-rdc-adapter',device_id=null}={}){
    const intent=await get(intentId);
    if(intent.status!=='AWAITING_CLAIM') throw Object.assign(new Error('RDC intent is not awaiting claim; current status '+intent.status),{code:'rdc_invalid_transition'});
    intent.status='CLAIMED'; intent.adapter={adapter_id,device_id,claimed_at:now(),lease_until:new Date(Date.now()+120000).toISOString()};
    await save(intent); await appendIntentEvent(intent,'CLAIMED',{adapter:intent.adapter});
    return intent;
  }

  async function setApproval(intentId,state){
    const intent=await get(intentId), normalized=String(state||'').toUpperCase();
    if(!['APPROVED','DENIED','PENDING_EXTERNAL'].includes(normalized)) throw Object.assign(new Error('Approval state must be APPROVED, DENIED or PENDING_EXTERNAL.'),{code:'rdc_invalid_approval'});
    if(TERMINAL.has(intent.status)) throw Object.assign(new Error('RDC intent is already terminal.'),{code:'rdc_invalid_transition'});
    intent.approval={...intent.approval,state:normalized,updated_at:now()};
    if(normalized==='DENIED') {intent.status='DENIED';intent.result={outcome:'DENIED',error:'Platform/user approval denied',ended_at:now()};}
    await save(intent); await appendIntentEvent(intent,'APPROVAL_'+normalized,{approval:intent.approval});
    if(normalized==='DENIED') await appendObserverEvent({actor:'RDC',event:'CANCELED',correlation_id:intent.correlation_id,run_id:intent.run_id,plan_id:intent.plan_id,task_id:intent.task_id,span_id:intent.span_id,message:'RDC execution denied by external approval boundary',source:{client:'RDC Adapter',conversation_id:intent.conversation_id,turn_id:intent.turn_id,locator:'rdc-intent:'+intent.intent_id,source_quality:'declared'},meta:{intent_id:intent.intent_id,approval:'DENIED'}},eventOptions);
    return intent;
  }

  async function start(intentId,{adapter_id='chatgpt-rdc-adapter',device_id=null}={}){
    const intent=await get(intentId);
    if(intent.status!=='CLAIMED') throw Object.assign(new Error('RDC intent must be CLAIMED before execution.'),{code:'rdc_invalid_transition'});
    if(intent.approval?.required && intent.approval.state!=='APPROVED') throw Object.assign(new Error('RDC platform approval must be APPROVED before execution.'),{code:'rdc_approval_required'});
    if(!intent.capabilities?.rdc_tools?.length) throw Object.assign(new Error('RDC intent has no mapped allowed tools; planning/scope must be refined.'),{code:'rdc_no_capabilities'});
    intent.status='RUNNING'; intent.started_at=now(); intent.adapter={...(intent.adapter||{}),adapter_id,device_id:device_id??intent.adapter?.device_id??null,started_at:intent.started_at,lease_until:new Date(Date.now()+120000).toISOString()};
    await save(intent); await appendIntentEvent(intent,'STARTED',{adapter:intent.adapter});
    await appendObserverEvent({actor:'RDC',event:'START',correlation_id:intent.correlation_id,run_id:intent.run_id,plan_id:intent.plan_id,task_id:intent.task_id,span_id:intent.span_id,message:'RDC executor started under EDH dispatch intent',source:{client:'RDC Adapter',conversation_id:intent.conversation_id,turn_id:intent.turn_id,action_label:intent.goal,locator:'rdc-intent:'+intent.intent_id,source_quality:'declared'},meta:{intent_id:intent.intent_id,device_id:intent.adapter.device_id,rdc_tools:intent.capabilities.rdc_tools}},eventOptions);
    return intent;
  }

  async function heartbeat(intentId){
    const intent=await get(intentId); if(intent.status!=='RUNNING') throw Object.assign(new Error('Only RUNNING RDC intents accept heartbeat.'),{code:'rdc_invalid_transition'});
    intent.adapter={...(intent.adapter||{}),lease_until:new Date(Date.now()+120000).toISOString(),last_heartbeat_at:now()}; await save(intent); return intent;
  }

  async function recordTool(intentId,{tool,phase='DONE',call_id=null,pid=null,duration_ms=null,error=null}={}){
    const intent=await get(intentId); if(intent.status!=='RUNNING') throw Object.assign(new Error('RDC intent is not RUNNING.'),{code:'rdc_invalid_transition'});
    tool=String(tool||''); phase=String(phase||'').toUpperCase();
    if(!intent.capabilities.rdc_tools.includes(tool)) throw Object.assign(new Error('RDC tool '+tool+' is outside this task intent capability set.'),{code:'rdc_capability_denied'});
    if(!['START','DONE','ERROR'].includes(phase)) throw Object.assign(new Error('RDC tool phase must be START, DONE or ERROR.'),{code:'rdc_invalid_tool_phase'});
    const seq=(intent.metrics.tool_calls||0)+(phase==='START'?1:0); if(phase==='START') intent.metrics.tool_calls=seq; if(phase==='ERROR') intent.metrics.tool_errors=(intent.metrics.tool_errors||0)+1;
    const child=intent.run_id+':tool:'+tool+':'+String(Math.max(seq,1));
    await appendIntentEvent(intent,'TOOL_'+phase,{tool,call_id,pid,duration_ms,error});
    await appendObserverEvent({actor:'RDC',event:phase,correlation_id:intent.correlation_id,run_id:intent.run_id,plan_id:intent.plan_id,task_id:intent.task_id,span_id:child,parent_span_id:intent.span_id,message:'RDC '+tool+' '+phase.toLowerCase(),source:{client:'RDC Adapter',conversation_id:intent.conversation_id,turn_id:intent.turn_id,locator:'rdc-intent:'+intent.intent_id,source_quality:'transport_observed'},meta:{intent_id:intent.intent_id,tool,call_id,pid,duration_ms,error}},eventOptions);
    await save(intent); return intent;
  }

  async function complete(intentId,{outcome='DONE',exit_code=null,error=null,artifacts=[],metrics={}}={}){
    const intent=await get(intentId); if(!['RUNNING','CLAIMED'].includes(intent.status)) throw Object.assign(new Error('RDC intent cannot complete from status '+intent.status),{code:'rdc_invalid_transition'});
    const normalized=String(outcome||'DONE').toUpperCase(); const status=['DONE','PASS','SUCCESS'].includes(normalized)?'DONE':normalized==='CANCELED'?'CANCELED':'ERROR';
    intent.status=status; intent.result={outcome:normalized,exit_code:Number.isInteger(exit_code)?exit_code:null,error:error?String(error).slice(0,1000):null,artifacts:Array.isArray(artifacts)?artifacts:[],ended_at:now()}; intent.metrics={...intent.metrics,...metrics};
    await save(intent); await appendIntentEvent(intent,'COMPLETED',{status,result:intent.result,metrics:intent.metrics});
    await appendObserverEvent({actor:'RDC',event:status==='DONE'?'DONE':status==='CANCELED'?'CANCELED':'ERROR',correlation_id:intent.correlation_id,run_id:intent.run_id,plan_id:intent.plan_id,task_id:intent.task_id,span_id:intent.span_id,message:'RDC executor '+(status==='DONE'?'completed':'ended '+status.toLowerCase()),source:{client:'RDC Adapter',conversation_id:intent.conversation_id,turn_id:intent.turn_id,action_label:intent.goal,locator:'rdc-intent:'+intent.intent_id,source_quality:'transport_observed'},meta:{intent_id:intent.intent_id,result:intent.result,metrics:intent.metrics}},eventOptions);
    return intent;
  }

  async function snapshot(){
    const intents=await list(); const latest=intents[0]||null; const active=intents.filter(x=>!TERMINAL.has(x.status));
    return {schema_version:'1.0',latest,active_count:active.length,pending:active.slice(0,10),root};
  }

  return {createIntent,list,get,claim,setApproval,start,heartbeat,recordTool,complete,snapshot,root};
}
