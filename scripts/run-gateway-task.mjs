#!/usr/bin/env node
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {appendObserverEvent} from './observer-events.mjs';
import {createTurnActionContext} from './turn-action-context.mjs';
import {runTaskEnvelope} from './run-task-envelope.mjs';

export async function runGatewayTask({contextPath,taskPath,repo=process.cwd(),runRoot}) {
  const input=JSON.parse(await readFile(resolve(contextPath),'utf8'));
  const ctx=createTurnActionContext(input);
  const task=JSON.parse(await readFile(resolve(taskPath),'utf8'));
  const root=resolve(runRoot||task.artifacts.run_dir);
  await mkdir(root,{recursive:true});
  await writeFile(resolve(root,'gateway-context.json'),JSON.stringify(ctx,null,2)+'\n');

  await appendObserverEvent({
    actor:'CHAT',event:'START',correlation_id:ctx.correlation_id,run_id:'turn:'+ctx.turn_id,
    span_id:ctx.turn_span_id,message:'ChatGPT turn started',source:ctx.source,
    meta:{action_id:ctx.action_id,action_label:ctx.action_label}
  });
  await appendObserverEvent({
    actor:'ACTION',event:'START',correlation_id:ctx.correlation_id,run_id:'turn:'+ctx.turn_id,
    span_id:ctx.action_span_id,parent_span_id:ctx.turn_span_id,
    message:ctx.action_label,source:ctx.source,
    meta:{action_id:ctx.action_id,action_label:ctx.action_label}
  });

  let report;
  try {
    report=await runTaskEnvelope(resolve(taskPath),{
      repo:resolve(repo),runRoot:root,
      traceContext:{correlationId:ctx.correlation_id,upstreamParentSpan:ctx.action_span_id},
      sourceOverride:ctx.source
    });
    const ok=report.status==='worker_ready_for_verification';
    await appendObserverEvent({
      actor:'ACTION',event:ok?'DONE':'ERROR',correlation_id:ctx.correlation_id,run_id:'turn:'+ctx.turn_id,
      span_id:ctx.action_span_id,parent_span_id:ctx.turn_span_id,
      message:ctx.action_label+(ok?' completed':' failed'),source:ctx.source,
      meta:{action_id:ctx.action_id,action_label:ctx.action_label,worker_status:report.status}
    });
    await appendObserverEvent({
      actor:'CHAT',event:ok?'DONE':'ERROR',correlation_id:ctx.correlation_id,run_id:'turn:'+ctx.turn_id,
      span_id:ctx.turn_span_id,message:'ChatGPT turn '+(ok?'completed':'failed'),source:ctx.source,
      meta:{action_id:ctx.action_id,action_label:ctx.action_label,worker_status:report.status}
    });
    return {gateway:ctx,report};
  } catch(error) {
    await appendObserverEvent({
      actor:'ACTION',event:'ERROR',correlation_id:ctx.correlation_id,run_id:'turn:'+ctx.turn_id,
      span_id:ctx.action_span_id,parent_span_id:ctx.turn_span_id,
      message:ctx.action_label+' failed: '+String(error.message||error),source:ctx.source,
      meta:{action_id:ctx.action_id,action_label:ctx.action_label}
    }).catch(()=>{});
    await appendObserverEvent({
      actor:'CHAT',event:'ERROR',correlation_id:ctx.correlation_id,run_id:'turn:'+ctx.turn_id,
      span_id:ctx.turn_span_id,message:'ChatGPT turn failed',source:ctx.source,
      meta:{action_id:ctx.action_id,action_label:ctx.action_label}
    }).catch(()=>{});
    throw error;
  }
}

async function main(){
  const args=process.argv.slice(2);
  const get=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:null;};
  const contextPath=get('--context'), taskPath=get('--task');
  if(!contextPath||!taskPath) throw new Error('usage: node scripts/run-gateway-task.mjs --context turn.json --task task.json [--repo path] [--run-dir path]');
  const result=await runGatewayTask({
    contextPath,taskPath,
    repo:get('--repo')||process.cwd(),
    runRoot:get('--run-dir')||undefined
  });
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
}
