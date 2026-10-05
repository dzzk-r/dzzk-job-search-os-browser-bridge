import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {basename,resolve} from 'node:path';
import {readFile} from 'node:fs/promises';

const execFileP=promisify(execFile);

async function git(root,args){
  try{return (await execFileP('git',['-C',root,...args],{encoding:'utf8'})).stdout.trim();}
  catch{return null;}
}

export async function readRepoContext(root=process.cwd()){
  root=resolve(root);
  const [top,branch,head,status]=await Promise.all([
    git(root,['rev-parse','--show-toplevel']),
    git(root,['rev-parse','--abbrev-ref','HEAD']),
    git(root,['rev-parse','HEAD']),
    git(root,['status','--porcelain'])
  ]);
  const repoRoot=top||root;
  let canonicalName=null;
  try{
    const pkg=JSON.parse(await readFile(resolve(repoRoot,'package.json'),'utf8'));
    canonicalName=typeof pkg.name==='string'&&pkg.name.trim()?pkg.name.trim():null;
  }catch{}
  return {
    name:canonicalName||basename(repoRoot).replace(/^_/,''),
    worktree:basename(root),
    branch:branch||null,
    head:head||null,
    dirty:Boolean(status)
  };
}

export async function readTaskCatalog(root=process.cwd()){
  let text='';
  try{text=await readFile(resolve(root,'TODO.md'),'utf8');}catch{return {};}
  const tasks={};
  for(const line of text.split('\n')){
    const m=line.match(/^\|\s*([A-Z]+-\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(\d+)%\s*\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|$/);
    if(!m) continue;
    tasks[m[1]]={
      id:m[1],
      title:m[2].trim(),
      signal:m[3].trim(),
      size:m[4].trim(),
      percent:Number(m[5]),
      eta:m[6].trim(),
      detail:m[7].trim()
    };
  }
  return tasks;
}

export async function readReadiness(root=process.cwd()){
  try{return JSON.parse(await readFile(resolve(root,'project/readiness.json'),'utf8'));}
  catch{return {schema_version:'1.0',project:null,milestones:[]};}
}

function mentionedTaskIds(request,catalog){
  const explicit=[
    request.task_id,
    request.parent_task_id,
    ...(request.related_task_ids||[])
  ].filter(Boolean);
  const haystack=JSON.stringify({
    goal:request.goal,
    evidence:request.evidence,
    constraints:request.constraints,
    non_goals:request.non_goals
  });
  for(const id of Object.keys(catalog)) if(haystack.includes(id)) explicit.push(id);
  return [...new Set(explicit.filter(id=>catalog[id]))];
}

export async function projectReadinessSnapshot(root=process.cwd()){
  const [config,catalog]=await Promise.all([readReadiness(root),readTaskCatalog(root)]);
  const computed=new Map();
  const milestones=[];
  for(const m of config.milestones){
    const supporting=(m.supporting_tasks||[]).map(id=>catalog[id]||{id,missing:true});
    const incomplete=supporting.filter(t=>t.missing||t.percent<100).map(t=>t.id);
    const dependencyBlockers=(m.depends_on||[]).filter(id=>computed.get(id)!=='READY');
    const status=incomplete.length===0&&dependencyBlockers.length===0?'READY':'BLOCKED';
    computed.set(m.id,status);
    milestones.push({
      ...m,
      configured_status:m.status,
      status,
      supporting_tasks:supporting,
      incomplete_tasks:incomplete,
      dependency_blockers:dependencyBlockers,
      blockers:[
        ...incomplete.map(id=>({type:'task',id})),
        ...dependencyBlockers.map(id=>({type:'milestone',id}))
      ]
    });
  }
  const highestReady=[...milestones].reverse().find(m=>m.status==='READY')?.id??null;
  const nextMilestone=milestones.find(m=>m.status!=='READY')?.id??null;
  return {schema_version:'1.0',project:config.project,highest_ready_milestone:highestReady,next_milestone:nextMilestone,milestones};
}

export async function buildCurrentTaskContext(request,{root=process.cwd(),runId=null,runDir=null,checkpoint=null}={}){
  const [repo,catalog,readiness]=await Promise.all([
    readRepoContext(root),
    readTaskCatalog(root),
    projectReadinessSnapshot(root)
  ]);
  const ids=mentionedTaskIds(request,catalog);
  const current=catalog[request.task_id]||null;
  const related=ids.filter(id=>id!==request.task_id).map(id=>catalog[id]).filter(Boolean);
  return {
    schema_version:'1.0',
    repo,
    task:{
      task_id:request.task_id,
      plan_id:request.plan_id,
      parent_task_id:request.parent_task_id??null,
      catalog_entry:current,
      related_tasks:related,
      goal:request.goal,
      scope:request.scope,
      constraints:request.constraints,
      non_goals:request.non_goals||[],
      evidence:request.evidence
    },
    run:{run_id:runId,run_dir:runDir,checkpoint:checkpoint||null},
    readiness
  };
}

async function main(){
  const root=process.cwd();
  const snapshot=await projectReadinessSnapshot(root);
  console.log(JSON.stringify(snapshot,null,2));
}
if(process.argv[1]&&import.meta.url===new URL('file:'+process.argv[1]).href) await main();
