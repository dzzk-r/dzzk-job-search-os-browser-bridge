import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';

const MODES=new Set(['AUTO','EDH','RDC','COMPARE']);

async function atomicJson(path,value){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const tmp=path+'.tmp-'+process.pid;
  await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});
  await rename(tmp,path);
}

async function readJson(path){
  try{return JSON.parse(await readFile(path,'utf8'));}
  catch(e){if(e.code==='ENOENT') return null; throw e;}
}

export function createExecutorPolicy(options={}){
  const statePath=resolve(options.statePath??join(homedir(),'.local/state/execution-delivery-harness/executor-policy.json'));
  const compareRoot=resolve(options.compareRoot??join(homedir(),'WORK','_edh-compare'));
  const intentRoot=resolve(options.intentRoot??join(homedir(),'.local/state/execution-delivery-harness/executor-intents'));

  async function state(){
    const raw=await readJson(statePath);
    const mode=MODES.has(raw?.mode)?raw.mode:'AUTO';
    return {
      schema_version:'1.0',
      mode,
      updated_at:raw?.updated_at||null,
      updated_by:raw?.updated_by||null,
      compare_root:compareRoot,
      semantics:{
        AUTO:'Harness chooses the next executor from current policy/readiness.',
        EDH:'Route the next prepared task through the EDH-owned executor path.',
        RDC:'Route the next prepared task through the RDC backend/adapter path.',
        COMPARE:'Create sibling EDH and RDC run plans from one immutable task envelope and baseline.'
      }
    };
  }

  async function setMode(mode,{updatedBy='owner'}={}){
    mode=String(mode||'').toUpperCase();
    if(!MODES.has(mode)) throw Object.assign(new Error('Executor mode must be AUTO, EDH, RDC or COMPARE.'),{code:'invalid_executor_mode'});
    const value={schema_version:'1.0',mode,updated_at:new Date().toISOString(),updated_by:updatedBy};
    await atomicJson(statePath,value);
    return state();
  }

  async function createDispatchIntent({task,executor,baseline_commit=null,source_run_dir=null,conversation_id=null,turn_id=null}={}){
    executor=String(executor||'').toUpperCase();
    if(!['EDH','RDC'].includes(executor)) throw Object.assign(new Error('Dispatch intent executor must be EDH or RDC.'),{code:'invalid_executor_mode'});
    if(!task||typeof task!=='object'||Array.isArray(task)||typeof task.task_id!=='string'||!task.task_id.trim()) throw Object.assign(new Error('A task envelope with task_id is required.'),{code:'invalid_compare_task'});
    const intent_id='dispatch:'+randomUUID();
    const value={
      schema_version:'1.0',intent_id,task_id:task.task_id,plan_id:task.plan_id||null,goal:task.goal||null,executor,
      status:executor==='RDC'?'AWAITING_EXTERNAL_EXECUTOR':'PLANNED',baseline_commit:baseline_commit||null,source_run_dir:source_run_dir||null,
      conversation_id:conversation_id||null,turn_id:turn_id||null,acceptance:Array.isArray(task.acceptance)?task.acceptance:[],budget:task.budget||{},created_at:new Date().toISOString()
    };
    await atomicJson(join(intentRoot,intent_id.replace(':','-')+'.json'),value);
    return value;
  }

  async function createComparisonPlan({task,baseline_commit=null,source_run_dir=null}={}){
    if(!task||typeof task!=='object'||Array.isArray(task)||typeof task.task_id!=='string'||!task.task_id.trim()) {
      throw Object.assign(new Error('A task envelope with task_id is required for comparison.'),{code:'invalid_compare_task'});
    }
    const comparison_id='cmp:'+randomUUID();
    const slug=comparison_id.replace(':','-');
    const root=resolve(compareRoot,slug);
    const common={
      schema_version:'1.0',comparison_id,task_id:task.task_id,plan_id:task.plan_id||null,
      goal:task.goal||null,baseline_commit:baseline_commit||null,source_run_dir:source_run_dir||null,
      acceptance:Array.isArray(task.acceptance)?task.acceptance:[],budget:task.budget||{},created_at:new Date().toISOString()
    };
    const plan={
      ...common,
      status:'PLANNED',
      runs:[
        {run_id:'compare:'+slug+':edh',executor:'EDH',status:'PLANNED',worktree:join(root,'edh'),run_dir:join(root,'runs','edh')},
        {run_id:'compare:'+slug+':rdc',executor:'RDC',status:'PLANNED',worktree:join(root,'rdc'),run_dir:join(root,'runs','rdc')}
      ],
      comparison:{winner:null,acceptance:null,tests:null,elapsed_seconds:null,tool_calls:null,token_usage:null,human_interventions:null,scope_violations:null}
    };
    await atomicJson(join(root,'comparison.json'),plan);
    return plan;
  }

  return {state,setMode,createDispatchIntent,createComparisonPlan,statePath,compareRoot,intentRoot};
}
