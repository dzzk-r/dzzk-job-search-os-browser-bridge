import { appendFile, mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const DEFAULT_CURRENT_RUN_STATE = join(homedir(),'.local','state','execution-delivery-harness','current-run.json');
export const DEFAULT_LAST_RUN_STATE = join(homedir(),'.local','state','execution-delivery-harness','last-run.json');
const TERMINAL_STATUSES = new Set(['DONE','ERROR','CANCELED']);

async function readJson(path) {
  try { return JSON.parse(await readFile(path,'utf8')); }
  catch { return null; }
}

async function atomicJson(path,value) {
  await mkdir(dirname(path),{recursive:true});
  const tmp=path+'.tmp-'+process.pid;
  await writeFile(tmp,JSON.stringify(value,null,2)+'\n');
  await rename(tmp,path);
}

async function appendEvent(runDir,event) {
  await mkdir(runDir,{recursive:true});
  await appendFile(join(runDir,'lifecycle.jsonl'),JSON.stringify(event)+'\n');
}

function nowIso() { return new Date().toISOString(); }

function pointerValue(checkpoint) {
  return {
    schema_version:'1.0',
    run_dir:checkpoint.run_dir,
    run_id:checkpoint.run_id,
    plan_id:checkpoint.plan_id,
    task_id:checkpoint.task_id,
    status:checkpoint.status,
    phase:checkpoint.phase,
    safe_to_interrupt:checkpoint.safe_to_interrupt,
    updated_at:checkpoint.updated_at
  };
}

async function publishPointer(checkpoint,stateFile) {
  await atomicJson(stateFile,pointerValue(checkpoint));
}

async function retirePointer(checkpoint,stateFile) {
  const lastStateFile=join(dirname(stateFile),'last-run.json');
  await atomicJson(lastStateFile,pointerValue(checkpoint));
  const current=await readJson(stateFile);
  if(current?.run_id===checkpoint.run_id && current?.run_dir===checkpoint.run_dir) {
    await unlink(stateFile).catch(error=>{ if(error.code!=='ENOENT') throw error; });
  }
}

export async function startLifecycle(runDir,input,{stateFile=DEFAULT_CURRENT_RUN_STATE}={}) {
  runDir=resolve(runDir);
  const ts=nowIso();
  const checkpoint={
    schema_version:'1.0',
    run_dir:runDir,
    run_id:input.run_id,
    plan_id:input.plan_id,
    task_id:input.task_id,
    goal:input.goal,
    status:input.status||'RUNNING',
    phase:input.phase||'STARTING',
    completed:input.completed||[],
    current:input.current??null,
    pending:input.pending||[],
    budget:input.budget||{},
    budget_used:input.budget_used||{},
    waiting_reason:input.waiting_reason??null,
    safe_to_interrupt:input.safe_to_interrupt||'after_checkpoint',
    last_durable_checkpoint:input.last_durable_checkpoint??null,
    source:input.source||{},
    execution_profile:input.execution_profile||{},
    started_at:ts,
    updated_at:ts
  };
  await mkdir(runDir,{recursive:true});
  await atomicJson(join(runDir,'checkpoint.json'),checkpoint);
  await appendEvent(runDir,{
    schema_version:'1.0',ts,type:'START',run_id:checkpoint.run_id,
    plan_id:checkpoint.plan_id,task_id:checkpoint.task_id,
    status:checkpoint.status,phase:checkpoint.phase,message:input.message||checkpoint.current||'run started'
  });
  await publishPointer(checkpoint,stateFile);
  return checkpoint;
}

export async function updateLifecycle(runDir,patch,{type='PROGRESS',message,stateFile=DEFAULT_CURRENT_RUN_STATE}={}) {
  runDir=resolve(runDir);
  const path=join(runDir,'checkpoint.json');
  const current=await readJson(path);
  if(!current) throw new Error('checkpoint.json is missing for '+runDir);
  const ts=nowIso();
  const next={
    ...current,
    ...patch,
    ...(patch.budget_used?{budget_used:{...(current.budget_used||{}),...patch.budget_used}}:{}),
    run_dir:runDir,updated_at:ts
  };
  await atomicJson(path,next);
  await appendEvent(runDir,{
    schema_version:'1.0',ts,type,run_id:next.run_id,plan_id:next.plan_id,
    task_id:next.task_id,status:next.status,phase:next.phase,
    message:message||patch.current||patch.waiting_reason||type.toLowerCase()
  });
  if(TERMINAL_STATUSES.has(String(next.status||'').toUpperCase())) await retirePointer(next,stateFile);
  else await publishPointer(next,stateFile);
  return next;
}

export async function readLifecycle(runDir) {
  return readJson(join(resolve(runDir),'checkpoint.json'));
}
