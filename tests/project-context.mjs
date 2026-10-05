import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {buildCurrentTaskContext,projectReadinessSnapshot,readTaskCatalog} from '../scripts/project-context.mjs';

const execFileP=promisify(execFile);

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'edh-project-context-'));
  await writeFile(join(root,'package.json'),JSON.stringify({name:'execution-delivery-harness'})+'\n');
  await writeFile(join(root,'TODO.md'),[
    '| ID | Task | Signal | Size | Progress | ETA | Sufficiency / remaining |',
    '| --- | --- | --- | --- | ---: | --- | --- |',
    '| CT-01 | Boundary | 🟩 **G** | XS | 100% | 0 h | done |',
    '| CT-03 | Desktop | 🟨 **Y** | M | 90% | 1 h | live acceptance |',
    '| REL-03 | Public | 🟥 **R** | XL | 10% | 3 d | distribution |'
  ].join('\n')+'\n');
  await mkdir(join(root,'project'));
  await writeFile(join(root,'project/readiness.json'),JSON.stringify({
    schema_version:'1.0',project:'execution-delivery-harness',
    milestones:[
      {id:'local',status:'pending',supporting_tasks:['CT-01']},
      {id:'private',status:'pending',depends_on:['local'],supporting_tasks:['CT-03']},
      {id:'public',status:'pending',depends_on:['private'],supporting_tasks:['REL-03']}
    ]
  }));
  await execFileP('git',['init','-q'],{cwd:root});
  await execFileP('git',['config','user.email','test@example.invalid'],{cwd:root});
  await execFileP('git',['config','user.name','test'],{cwd:root});
  await execFileP('git',['add','.'],{cwd:root});
  await execFileP('git',['commit','-qm','fixture'],{cwd:root});
  return root;
}

test('project readiness is milestone based and exposes blockers',async()=>{
  const root=await fixture();
  try{
    const snapshot=await projectReadinessSnapshot(root);
    assert.equal(snapshot.milestones[0].status,'READY');
    assert.equal(snapshot.milestones[1].status,'BLOCKED');
    assert.deepEqual(snapshot.milestones[1].incomplete_tasks,['CT-03']);
    assert.equal(snapshot.highest_ready_milestone,'local');
    assert.equal(snapshot.next_milestone,'private');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('current task context anchors repo, task and readiness',async()=>{
  const root=await fixture();
  try{
    const request={
      task_id:'CT-03',plan_id:'plan-ct03',goal:'Finish CT-03 after CT-01',
      evidence:[],scope:{reads:[],writes:[],tools:[]},constraints:[],non_goals:[]
    };
    const ctx=await buildCurrentTaskContext(request,{root,runId:'run-1',runDir:'/tmp/run-1'});
    assert.equal(ctx.task.catalog_entry.id,'CT-03');
    assert.equal(ctx.task.related_tasks[0].id,'CT-01');
    assert.match(ctx.repo.head,/^[a-f0-9]{40}$/);
    assert.equal(ctx.repo.name,'execution-delivery-harness');
    assert.equal(ctx.run.run_id,'run-1');
    assert.equal(ctx.readiness.next_milestone,'private');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('task catalog remains the authoritative work-state parser',async()=>{
  const root=await fixture();
  try{
    const catalog=await readTaskCatalog(root);
    assert.equal(catalog['CT-03'].percent,90);
    assert.equal(catalog['REL-03'].signal,'🟥 **R**');
  }finally{await rm(root,{recursive:true,force:true});}
});
