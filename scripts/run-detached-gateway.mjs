#!/usr/bin/env node
import {open,readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {homedir} from 'node:os';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {runGatewayTask} from './run-gateway-task.mjs';

const STATE=resolve(homedir(),'.local/state/execution-delivery-harness/detached-run.json');

async function atomicJson(path,value){
  await mkdir(dirname(path),{recursive:true});
  const tmp=path+'.tmp-'+process.pid;
  await writeFile(tmp,JSON.stringify(value,null,2)+'\n');
  await rename(tmp,path);
}

function iso(){return new Date().toISOString();}

async function childMain(args){
  const get=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:null;};
  const runDir=resolve(get('--run-dir'));
  const controllerId=get('--controller-id');
  const contextPath=resolve(get('--context'));
  const taskPath=resolve(get('--task'));
  const repo=resolve(get('--repo'));
  const started=iso();
  let state={
    schema_version:'1.0',
    controller_id:controllerId,
    owner:'harness',
    mode:'detached',
    status:'RUNNING',
    phase:'DISPATCHED',
    pid:process.pid,
    run_dir:runDir,
    context_path:contextPath,
    task_path:taskPath,
    started_at:started,
    heartbeat_at:started,
    safe_to_interrupt:'after_checkpoint'
  };
  await atomicJson(resolve(runDir,'detached-state.json'),state);
  await atomicJson(STATE,state);
  const beat=setInterval(async()=>{
    state={...state,heartbeat_at:iso()};
    await atomicJson(resolve(runDir,'detached-state.json'),state).catch(()=>{});
    await atomicJson(STATE,state).catch(()=>{});
  },2000);
  beat.unref();
  try{
    state={...state,phase:'RUNNING',heartbeat_at:iso()};
    await atomicJson(resolve(runDir,'detached-state.json'),state);
    await atomicJson(STATE,state);
    const result=await runGatewayTask({contextPath,taskPath,repo,runRoot:runDir});
    state={...state,status:'DONE',phase:'FINISHED',heartbeat_at:iso(),ended_at:iso(),worker_status:result.report?.status||null};
    await atomicJson(resolve(runDir,'detached-state.json'),state);
    await atomicJson(STATE,state);
  }catch(error){
    state={...state,status:'ERROR',phase:'FAILED',heartbeat_at:iso(),ended_at:iso(),error:String(error?.message||error)};
    await atomicJson(resolve(runDir,'detached-state.json'),state).catch(()=>{});
    await atomicJson(STATE,state).catch(()=>{});
    process.exitCode=1;
  }finally{
    clearInterval(beat);
  }
}

export async function launchDetachedGateway({contextPath,taskPath,repo=process.cwd(),runDir}){
  contextPath=resolve(contextPath); taskPath=resolve(taskPath); repo=resolve(repo); runDir=resolve(runDir);
  await mkdir(runDir,{recursive:true});
  const controllerId='detached:'+randomUUID();
  const stdoutPath=resolve(runDir,'detached.stdout.log');
  const stderrPath=resolve(runDir,'detached.stderr.log');
  const out=await open(stdoutPath,'a');
  const err=await open(stderrPath,'a');
  const argv=[process.argv[1],'--child','--controller-id',controllerId,'--context',contextPath,'--task',taskPath,'--repo',repo,'--run-dir',runDir];
  const child=spawn(process.execPath,argv,{cwd:repo,detached:true,stdio:['ignore',out.fd,err.fd]});
  child.unref();
  const state={
    schema_version:'1.0',controller_id:controllerId,owner:'harness',mode:'detached',
    status:'STARTING',phase:'DETACHING',pid:child.pid,run_dir:runDir,
    context_path:contextPath,task_path:taskPath,stdout_path:stdoutPath,stderr_path:stderrPath,
    started_at:iso(),heartbeat_at:null,safe_to_interrupt:'after_checkpoint'
  };
  await atomicJson(resolve(runDir,'detached-state.json'),state);
  await atomicJson(STATE,state);
  await out.close(); await err.close();
  return state;
}

async function main(){
  const args=process.argv.slice(2);
  if(args.includes('--child')) return childMain(args);
  const get=name=>{const i=args.indexOf(name);return i>=0?args[i+1]:null;};
  const contextPath=get('--context'),taskPath=get('--task'),runDir=get('--run-dir');
  if(!contextPath||!taskPath||!runDir) throw new Error('usage: node scripts/run-detached-gateway.mjs --context turn.json --task task.json --run-dir dir [--repo path]');
  const state=await launchDetachedGateway({contextPath,taskPath,runDir,repo:get('--repo')||process.cwd()});
  process.stdout.write(JSON.stringify(state)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(e=>{console.error(e.stack||e.message);process.exitCode=1;});
}
