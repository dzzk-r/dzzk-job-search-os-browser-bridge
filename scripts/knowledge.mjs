import {appendFile,mkdir,readdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import process from 'node:process';

export const DEFAULT_KNOWLEDGE_ROOT=resolve(process.env.EDH_KNOWLEDGE_ROOT||'knowledge');

const now=()=>new Date().toISOString();
const norm=s=>String(s??'').toLowerCase();
const terms=s=>norm(s).match(/[a-z0-9][a-z0-9._:/+-]{1,}/g)||[];

async function readJson(path){return JSON.parse(await readFile(path,'utf8'));}

async function atomicJson(path,value){
  await mkdir(dirname(path),{recursive:true});
  const tmp=path+'.tmp-'+process.pid;
  await writeFile(tmp,JSON.stringify(value,null,2)+'\n');
  await rename(tmp,path);
}

export async function appendKnowledgeEvent(event,{root=DEFAULT_KNOWLEDGE_ROOT}={}){
  const value={
    schema_version:'1.0',
    ts:event.ts||now(),
    type:event.type,
    subject:event.subject,
    message:event.message,
    refs:event.refs||[],
    tags:event.tags||[]
  };
  await mkdir(root,{recursive:true});
  await appendFile(join(root,'events.jsonl'),JSON.stringify(value)+'\n');
  return value;
}

export async function putKnowledgeRecord(record,{root=DEFAULT_KNOWLEDGE_ROOT}={}){
  const ts=now(), id=record.id;
  if(!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(id||'')) throw new Error('invalid knowledge record id');
  const path=join(root,'records',id+'.json');
  let created=ts;
  try{created=(await readJson(path)).created_at||ts;}catch{}
  const value={
    schema_version:'1.0',
    id,
    kind:record.kind,
    title:record.title,
    summary:record.summary,
    status:record.status||'active',
    claims:record.claims||[],
    decision:record.decision??null,
    rationale:record.rationale??null,
    tags:[...new Set(record.tags||[])],
    entities:[...new Set(record.entities||[])],
    evidence:record.evidence||[],
    supersedes:record.supersedes||[],
    context:record.context||{scope:'global',repo:{name:'unknown',worktree:null,branch:null,head:null},task_ids:[],plan_id:null,run_id:null,source_artifacts:[]},
    created_at:created,
    updated_at:ts
  };
  await atomicJson(path,value);
  return value;
}

export async function listKnowledgeRecords({root=DEFAULT_KNOWLEDGE_ROOT}={}){
  const dir=join(root,'records');
  let files=[];
  try{files=(await readdir(dir)).filter(x=>x.endsWith('.json'));}catch{return [];}
  return Promise.all(files.map(f=>readJson(join(dir,f))));
}

function contextMatches(record,{repoName=null,taskIds=[]}={}){
  const ctx=record.context||{};
  if(repoName && ctx.scope!=='global' && ctx.repo?.name!==repoName) return false;
  if(taskIds.length && ctx.scope==='task' && !(ctx.task_ids||[]).some(id=>taskIds.includes(id))) return false;
  return true;
}

function score(record,query){
  const q=[...new Set(terms(query))];
  if(!q.length) return 0;
  const weighted=[
    [record.title,8],
    [record.id,7],
    [(record.tags||[]).join(' '),6],
    [(record.entities||[]).join(' '),6],
    [record.summary,4],
    [(record.claims||[]).join(' '),3],
    [record.decision,3],
    [record.rationale,2]
  ];
  let total=0;
  for(const term of q) for(const [text,weight] of weighted) if(norm(text).includes(term)) total+=weight;
  if(record.status==='active') total+=1;
  return total;
}

export async function queryKnowledge(query,{root=DEFAULT_KNOWLEDGE_ROOT,limit=8,repoName=null,taskIds=[]}={}){
  const rows=(await listKnowledgeRecords({root})).filter(record=>contextMatches(record,{repoName,taskIds}));
  return rows.map(record=>({record,score:score(record,query)}))
    .filter(x=>x.score>0)
    .sort((a,b)=>b.score-a.score||b.record.updated_at.localeCompare(a.record.updated_at))
    .slice(0,limit);
}

export async function recentKnowledgeEvents({root=DEFAULT_KNOWLEDGE_ROOT,limit=12}={}){
  let text='';
  try{text=await readFile(join(root,'events.jsonl'),'utf8');}catch{return [];}
  return text.trim().split('\n').filter(Boolean).slice(-limit).map(line=>JSON.parse(line));
}

export async function buildKnowledgeContext(query,{root=DEFAULT_KNOWLEDGE_ROOT,limit=6,eventLimit=8,repoName=null,taskIds=[]}={}){
  const hits=await queryKnowledge(query,{root,limit,repoName,taskIds});
  return {
    schema_version:'1.0',
    query,
    generated_at:now(),
    records:hits.map(({record,score})=>({
      score,
      id:record.id,
      kind:record.kind,
      title:record.title,
      summary:record.summary,
      decision:record.decision,
      claims:record.claims,
      tags:record.tags,
      entities:record.entities,
      evidence:record.evidence,
      context:record.context
    })),
    recent_events:await recentKnowledgeEvents({root,limit:eventLimit})
  };
}

async function cli(){
  const [cmd,...args]=process.argv.slice(2);
  if(cmd==='query'){console.log(JSON.stringify(await queryKnowledge(args.join(' ')),null,2));return;}
  if(cmd==='context'){console.log(JSON.stringify(await buildKnowledgeContext(args.join(' ')),null,2));return;}
  if(cmd==='show'){console.log(JSON.stringify(await readJson(join(DEFAULT_KNOWLEDGE_ROOT,'records',args[0]+'.json')),null,2));return;}
  if(cmd==='event'){
    const [type,subject,...message]=args;
    console.log(JSON.stringify(await appendKnowledgeEvent({type,subject,message:message.join(' ')})));
    return;
  }
  console.error('usage: node scripts/knowledge.mjs query <text> | context <text> | show <id> | event <TYPE> <subject> <message>');
  process.exitCode=2;
}

const invoked=process.argv[1]&&import.meta.url===new URL('file:'+process.argv[1]).href;
if(invoked) await cli();
