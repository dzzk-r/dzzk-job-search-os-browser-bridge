import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readTaskCatalog, projectReadinessSnapshot } from '../scripts/project-context.mjs';
import { startLifecycle, updateLifecycle, DEFAULT_CURRENT_RUN_STATE } from '../scripts/run-lifecycle.mjs';
import { validatePlanningDocument } from '../scripts/planning-contract.mjs';

const TERMINAL=new Set(['DONE','ERROR','CANCELED']);

async function readJson(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT') return null; throw e;}}
async function atomicJson(path,value){await mkdir(dirname(path),{recursive:true,mode:0o700});const tmp=path+'.tmp-'+process.pid;await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(tmp,path);}
function stamp(){return new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,14);}
function safeId(value){return String(value).replace(/[^A-Za-z0-9_.-]+/g,'-');}

export function createTaskAdmission(options={}){
  const repoRoot=resolve(options.repoRoot??process.cwd());
  const statePath=resolve(options.statePath??join(homedir(),'.local/state/execution-delivery-harness/task-admission.json'));
  const runRoot=resolve(options.runRoot??join(homedir(),'WORK','browser-bridge-runs','admissions'));
  const currentRunPath=resolve(options.currentRunPath??DEFAULT_CURRENT_RUN_STATE);

  async function current(){return readJson(statePath);}

  async function list(){
    const [catalog,readiness,currentAdmission]=await Promise.all([readTaskCatalog(repoRoot),projectReadinessSnapshot(repoRoot),current()]);
    const next=readiness.milestones.find(m=>m.id===readiness.next_milestone)||null;
    const nextIds=new Set(next?.incomplete_tasks||[]);
    const tasks=Object.values(catalog).filter(t=>t.percent<100).map(t=>({
      ...t,
      priority:nextIds.has(t.id)?'next_milestone':'backlog',
      admitted:currentAdmission?.status==='ADMITTED'&&currentAdmission?.backlog_task_id===t.id
    })).sort((a,b)=>{
      const ap=a.priority==='next_milestone'?0:1,bp=b.priority==='next_milestone'?0:1;
      if(ap!==bp) return ap-bp;
      if(a.percent!==b.percent) return b.percent-a.percent;
      return a.id.localeCompare(b.id);
    });
    let envelope={ready:false,status:'PLANNING_REQUIRED',task_path:null,task_id:null,goal:null};
    if(currentAdmission?.status==='ADMITTED') {
      const taskPath=join(currentAdmission.run_dir,'task.json');
      try {
        const task=JSON.parse(await readFile(taskPath,'utf8'));
        await validatePlanningDocument('task',task);
        envelope={ready:true,status:'READY_FOR_HANDOFF',task_path:taskPath,task_id:task.task_id,goal:task.goal};
      } catch {}
    }
    return {
      schema_version:'1.0',project:readiness.project,next_milestone:next?{id:next.id,title:next.title}:null,
      recommended:tasks[0]||null,tasks,current_admission:currentAdmission,envelope
    };
  }

  async function take(backlogTaskId,{source={client:'chrome-side-panel'}}={}){
    const catalog=await readTaskCatalog(repoRoot);
    const item=catalog[backlogTaskId];
    if(!item) throw Object.assign(new Error('Unknown backlog task '+backlogTaskId),{code:'unknown_backlog_task'});
    if(item.percent>=100) throw Object.assign(new Error(backlogTaskId+' is already complete.'),{code:'backlog_task_complete'});
    const pointer=await readJson(currentRunPath);
    if(pointer && !TERMINAL.has(String(pointer.status||'').toUpperCase())) throw Object.assign(new Error('Another lifecycle task is already current: '+(pointer.task_id||pointer.run_id||'unknown')),{code:'current_task_exists'});
    const prior=await current();
    if(prior?.status==='ADMITTED') throw Object.assign(new Error('Backlog task '+prior.backlog_task_id+' is already admitted. Release it before taking another.'),{code:'admission_exists'});
    const admissionId='admission:'+randomUUID();
    const runtimeTaskId=item.id+'-NEXT-'+stamp();
    const runDir=resolve(runRoot,stamp()+'-'+safeId(item.id));
    const record={
      schema_version:'1.0',admission_id:admissionId,status:'ADMITTED',backlog_task_id:item.id,
      runtime_task_id:runtimeTaskId,title:item.title,goal:'Advance '+item.id+': '+item.title,
      backlog_percent_at_take:item.percent,backlog_detail:item.detail,next_step:'PLANNING_REQUIRED',
      run_dir:runDir,taken_at:new Date().toISOString(),source
    };
    await mkdir(runDir,{recursive:true});
    await atomicJson(join(runDir,'admission.json'),record);
    await atomicJson(statePath,record);
    await startLifecycle(runDir,{
      run_id:admissionId,plan_id:'backlog:'+item.id,task_id:runtimeTaskId,goal:record.goal,
      status:'WAITING',phase:'PLANNING_REQUIRED',completed:['backlog_selected'],
      current:'Define one bounded executable task envelope',
      pending:['Confirm exact scope','Define concrete acceptance','Persist task.json','Prepare handoff'],
      budget:{deadline_seconds:600,max_agent_steps:6,max_output_tokens:1800,max_repairs:1},
      waiting_reason:'A TODO backlog item is not yet a safe executable task. Bounded scope and acceptance are required.',
      safe_to_interrupt:'yes',last_durable_checkpoint:'admission.json',
      source:{...source,backlog_task_id:item.id,admission_id:admissionId},execution_profile:{executor:'unassigned'}
    },{stateFile:currentRunPath});
    return record;
  }

  async function takeNext(options={}){
    const snapshot=await list();
    if(!snapshot.recommended) throw Object.assign(new Error('No incomplete backlog task is available.'),{code:'no_backlog_task'});
    return take(snapshot.recommended.id,options);
  }

  async function release({reason='released by owner'}={}){
    const admission=await current();
    if(!admission||admission.status!=='ADMITTED') throw Object.assign(new Error('No admitted backlog task to release.'),{code:'no_admission'});
    await updateLifecycle(admission.run_dir,{
      status:'CANCELED',phase:'RELEASED',current:null,pending:[],waiting_reason:null,safe_to_interrupt:'yes',last_durable_checkpoint:'admission.json'
    },{type:'CANCELED',message:reason,stateFile:currentRunPath});
    const next={...admission,status:'RELEASED',released_at:new Date().toISOString(),release_reason:reason};
    await atomicJson(join(admission.run_dir,'admission.json'),next);
    await atomicJson(statePath,next);
    return next;
  }

  async function handoffCandidate(){
    const admission=await current();
    if(!admission||admission.status!=='ADMITTED') throw Object.assign(new Error('No admitted backlog task is available for handoff.'),{code:'no_admission'});
    const taskPath=join(admission.run_dir,'task.json');
    let task;
    try { task=JSON.parse(await readFile(taskPath,'utf8')); }
    catch { throw Object.assign(new Error('No bounded task.json exists yet. Planning is still required.'),{code:'planning_required'}); }
    try { await validatePlanningDocument('task',task); }
    catch(error) { throw Object.assign(new Error('task.json is not a valid bounded task envelope: '+error.message),{code:'invalid_task_envelope'}); }
    const contextPath=join(admission.run_dir,'turn-context.json');
    const context={schema_version:'1.0',client:'chrome-side-panel',conversation_id:null,turn_id:null,message_id:null,action_id:null,action_label:'Execute admitted backlog task '+admission.backlog_task_id,locator:'project backlog admission',source_quality:'declared'};
    await atomicJson(contextPath,context);
    return {label:admission.backlog_task_id+' · '+task.task_id,goal:task.goal,task_id:task.task_id,context_path:contextPath,task_path:taskPath,run_dir:task.artifacts?.run_dir||admission.run_dir,admission,task};
  }

  async function markPrepared(prepared){
    const admission=await current();
    if(!admission||admission.status!=='ADMITTED') throw Object.assign(new Error('No admitted backlog task to mark prepared.'),{code:'no_admission'});
    const next={...admission,next_step:'READY_FOR_HANDOFF',prepared_at:prepared.prepared_at||new Date().toISOString(),prepared_task_id:prepared.task_id||null};
    await atomicJson(join(admission.run_dir,'admission.json'),next);
    await atomicJson(statePath,next);
    await updateLifecycle(admission.run_dir,{
      status:'WAITING',phase:'READY_FOR_HANDOFF',completed:['backlog_selected','bounded_task_defined'],
      current:'Await owner dispatch',pending:['Dispatch prepared task'],waiting_reason:'Bounded task envelope is ready; choose executor policy and Dispatch.',
      safe_to_interrupt:'yes',last_durable_checkpoint:'task.json'
    },{type:'WAITING',message:'bounded task envelope ready for handoff',stateFile:currentRunPath});
    return next;
  }

  return {list,current,take,takeNext,release,handoffCandidate,markPrepared,statePath,runRoot};
}
