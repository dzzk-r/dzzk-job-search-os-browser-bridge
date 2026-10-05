#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { validatePlanningDocument } from './planning-contract.mjs';
import { startLifecycle, updateLifecycle } from './run-lifecycle.mjs';
import { appendObserverEvent, newCorrelationId } from './observer-events.mjs';

function taskText(task) {
  const acceptance=task.acceptance.map(a=>'- '+a.id+': '+a.description+' Evidence: '+a.evidence_required).join('\n');
  const constraints=(task.constraints||[]).map(x=>'- '+x).join('\n');
  const nonGoals=(task.non_goals||[]).map(x=>'- '+x).join('\n');
  return [
    task.goal,
    '',
    'Constraints:',
    constraints||'- none',
    '',
    'Non-goals:',
    nonGoals||'- none',
    '',
    'Acceptance evidence required:',
    acceptance
  ].join('\n').slice(0,3000);
}

export function resolveCorrelationContext(env=process.env) {
  return {
    correlationId:env.EDH_CORRELATION_ID||newCorrelationId(),
    upstreamParentSpan:env.EDH_PARENT_SPAN_ID||null,
    upstreamRunId:env.EDH_MCP_RUN_ID||null,
    upstreamTool:env.EDH_MCP_TOOL||null
  };
}

function runProcess(command,args,{cwd}) {
  return new Promise((resolvePromise,reject)=>{
    const child=spawn(command,args,{cwd,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',d=>{stdout+=d;process.stdout.write(d);});
    child.stderr.on('data',d=>{stderr+=d;process.stderr.write(d);});
    child.on('error',reject);
    child.on('close',code=>resolvePromise({code,stdout,stderr}));
  });
}

export async function runTaskEnvelope(taskPath,{repo=process.cwd(),opencode='/opt/homebrew/bin/opencode',runRoot,traceContext=null,sourceOverride=null}={}) {
  repo=resolve(repo);
  const task=JSON.parse(await readFile(resolve(taskPath),'utf8'));
  await validatePlanningDocument('task',task);
  const runDir=resolve(runRoot||task.artifacts.run_dir);
  await mkdir(runDir,{recursive:true});
  const workerTaskDir=resolve(repo,'artifacts','worker-tasks');
  await mkdir(workerTaskDir,{recursive:true});
  const workerTask=resolve(workerTaskDir,task.task_id+'.md');
  await writeFile(workerTask,taskText(task)+'\n');

  const runId='worker:'+task.task_id;
  const resolvedTrace=traceContext||resolveCorrelationContext();
  const {correlationId,upstreamParentSpan}=resolvedTrace;
  const executionSource=sourceOverride||task.source||{};
  const termSpan=runId+':term';
  await startLifecycle(runDir,{
    run_id:runId,plan_id:task.plan_id,task_id:task.task_id,goal:task.goal,
    phase:'WORKER_STARTING',completed:['task_validated'],current:'Start bounded worker',
    pending:['Apply bounded edit','Collect worker report','Verify acceptance evidence'],
    budget:task.budget,safe_to_interrupt:'after_checkpoint',source:executionSource,
    execution_profile:task.execution_profile,message:'bounded worker starting'
  });
  await updateLifecycle(runDir,{
    phase:'WORKER_RUNNING',current:'OpenCode/Qwen bounded implementation',
    waiting_reason:'local model/tool execution',safe_to_interrupt:'no'
  },{type:'PROGRESS',message:'worker execution started'});

  const expectedWrite=task.scope.writes[0];
  if(!expectedWrite) throw new Error('task scope has no permitted write target');
  const args=['scripts/local-agent.py','--task',workerTask,'--expect',expectedWrite,
    '--seconds',String(task.budget.deadline_seconds||300),
    '--steps',String(task.budget.max_agent_steps||6),
    '--tokens',String(task.budget.max_output_tokens||1800),
    '--opencode',opencode,'--run-root',resolve(runDir,'agent-runs'),
    '--run-id',runId,'--plan-id',task.plan_id,'--task-id',task.task_id,
    '--correlation-id',correlationId,'--parent-span-id',termSpan,
    '--source-json',JSON.stringify(executionSource)];
  for(const p of task.scope.reads||[]) args.push('--read',p);
  for(const p of task.scope.writes||[]) args.push('--write',p);

  await appendObserverEvent({
    actor:'TERM',event:'START',correlation_id:correlationId,run_id:runId,plan_id:task.plan_id,task_id:task.task_id,
    span_id:termSpan,parent_span_id:upstreamParentSpan,message:'local worker process started',source:executionSource
  });
  const result=await runProcess('python3',args,{cwd:repo});
  await appendObserverEvent({
    actor:'TERM',event:result.code===0?'DONE':'ERROR',correlation_id:correlationId,run_id:runId,plan_id:task.plan_id,task_id:task.task_id,
    span_id:termSpan,parent_span_id:upstreamParentSpan,message:'local worker process exited '+result.code,source:executionSource
  });
  const workerReport={
    schema_version:'1.0',correlation_id:correlationId,plan_id:task.plan_id,task_id:task.task_id,
    exit:result.code,status:result.code===0?'worker_ready_for_verification':'worker_failed',
    stdout_tail:result.stdout.slice(-4000),stderr_tail:result.stderr.slice(-2000)
  };
  await writeFile(resolve(runDir,'worker-report.json'),JSON.stringify(workerReport,null,2)+'\n');

  if(result.code===0) {
    await updateLifecycle(runDir,{
      status:'WAITING',phase:'VERIFYING',completed:['task_validated','worker_execution'],
      current:'Harness-owned acceptance verification',pending:['Acceptance decision'],
      waiting_reason:'verification not yet implemented in this adapter',
      safe_to_interrupt:'yes',last_durable_checkpoint:'worker-report.json'
    },{type:'WAITING',message:'worker finished; verification pending'});
  } else {
    await updateLifecycle(runDir,{
      status:'ERROR',phase:'WORKER_FAILED',completed:['task_validated'],
      current:null,pending:[],waiting_reason:null,safe_to_interrupt:'yes',
      last_durable_checkpoint:'worker-report.json'
    },{type:'ERROR',message:'bounded worker failed with exit '+result.code});
  }
  return workerReport;
}

async function main() {
  const args=process.argv.slice(2);
  const taskIndex=args.indexOf('--task');
  const repoIndex=args.indexOf('--repo');
  const runIndex=args.indexOf('--run-dir');
  if(taskIndex<0||!args[taskIndex+1]) throw new Error('usage: node scripts/run-task-envelope.mjs --task task.json [--repo path] [--run-dir path]');
  const taskPath=resolve(args[taskIndex+1]);
  const task=JSON.parse(await readFile(taskPath,'utf8'));
  const report=await runTaskEnvelope(taskPath,{
    repo:repoIndex>=0?resolve(args[repoIndex+1]):process.cwd(),
    runRoot:runIndex>=0?resolve(args[runIndex+1]):task.artifacts.run_dir
  });
  process.stdout.write(JSON.stringify(report)+'\n');
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
}
