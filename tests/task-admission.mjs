import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createTaskAdmission} from '../server/task-admission.mjs';
import {createPreparedDispatch} from '../server/prepared-dispatch.mjs';

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'edh-admission-'));
  await writeFile(join(root,'package.json'),JSON.stringify({name:'execution-delivery-harness'}));
  await writeFile(join(root,'TODO.md'),[
    '| ID | Task | Signal | Size | Done | Remaining ETA | Detail |',
    '| --- | --- | --- | --- | ---: | ---: | --- |',
    '| A-01 | First gate | Y | S | 80% | 1 h | finish first |',
    '| A-02 | Second gate | Y | M | 40% | 2 h | finish second |',
    '| B-01 | Later work | Y | S | 90% | 1 h | later |'
  ].join('\n'));
  await import('node:fs/promises').then(x=>x.mkdir(join(root,'project'),{recursive:true}));
  await writeFile(join(root,'project/readiness.json'),JSON.stringify({schema_version:'1.0',project:'execution-delivery-harness',milestones:[{id:'m1',title:'Milestone one',supporting_tasks:['A-01','A-02']}]}));
  return root;
}

test('task admission recommends incomplete work from next milestone and creates Current task lifecycle',async()=>{
  const root=await fixture(), state=join(root,'admission.json'), current=join(root,'current-run.json'), runs=join(root,'runs');
  const admission=createTaskAdmission({repoRoot:root,statePath:state,currentRunPath:current,runRoot:runs});
  const list=await admission.list();
  assert.equal(list.recommended.id,'A-01');
  assert.equal(list.tasks[0].priority,'next_milestone');
  const taken=await admission.takeNext();
  assert.equal(taken.backlog_task_id,'A-01');
  assert.equal(taken.next_step,'PLANNING_REQUIRED');
  const pointer=JSON.parse(await readFile(current,'utf8'));
  assert.equal(pointer.status,'WAITING');
  assert.equal(pointer.phase,'PLANNING_REQUIRED');
  const checkpoint=JSON.parse(await readFile(join(taken.run_dir,'checkpoint.json'),'utf8'));
  assert.equal(checkpoint.source.backlog_task_id,'A-01');
  await assert.rejects(()=>admission.take('A-02'),/already current|already admitted/);
});

test('releasing admission terminalizes lifecycle and allows another backlog item',async()=>{
  const root=await fixture(), state=join(root,'admission.json'), current=join(root,'current-run.json'), runs=join(root,'runs');
  const admission=createTaskAdmission({repoRoot:root,statePath:state,currentRunPath:current,runRoot:runs});
  await admission.take('A-01');
  const released=await admission.release({reason:'choose another'});
  assert.equal(released.status,'RELEASED');
  await assert.rejects(()=>readFile(current,'utf8'),e=>e.code==='ENOENT');
  const second=await admission.take('A-02');
  assert.equal(second.backlog_task_id,'A-02');
});


test('admitted backlog item becomes prepared handoff only after a valid bounded task envelope exists',async()=>{
  const root=await fixture(), state=join(root,'admission.json'), current=join(root,'current-run.json'), runs=join(root,'runs');
  const admission=createTaskAdmission({repoRoot:root,statePath:state,currentRunPath:current,runRoot:runs});
  const taken=await admission.take('A-01');
  assert.equal((await admission.list()).envelope.status,'PLANNING_REQUIRED');
  const task={
    schema_version:'1.0',task_id:'A-01-IMPL-01',plan_id:'backlog:A-01',parent_task_id:null,
    goal:'Implement one bounded part of A-01',
    evidence:[{kind:'repo',locator:'TODO.md#A-01',summary:'A-01 is selected backlog work'}],
    scope:{reads:['TODO.md'],writes:['result.txt'],tools:['read','edit','test']},
    constraints:['Do not modify files outside declared scope'],non_goals:[],
    acceptance:[{id:'A1',description:'bounded result exists',evidence_required:'result.txt'}],
    risk_class:'low',budget:{deadline_seconds:120,max_agent_steps:4,max_output_tokens:1000,max_repairs:0},
    escalation_conditions:['Declared scope is insufficient'],
    artifacts:{run_dir:taken.run_dir,expected:['result.txt']},
    source:{client:'chrome-side-panel',conversation_id:null,turn_id:null,message_id:null,locator:'project backlog admission'},
    execution_profile:{executor:'opencode',provider:'llamacpp',model:'qwen3.8-27b',runtime:'llama.cpp'}
  };
  await writeFile(join(taken.run_dir,'task.json'),JSON.stringify(task,null,2)+'\n');
  const listed=await admission.list();
  assert.equal(listed.envelope.status,'READY_FOR_HANDOFF');
  const candidate=await admission.handoffCandidate();
  const dispatch=createPreparedDispatch({repoRoot:root,workRoot:root,statePath:join(root,'prepared.json'),runner:join(root,'runner.mjs')});
  const prepared=await dispatch.prepare(candidate);
  assert.equal(prepared.ready,true);
  assert.equal(prepared.task_id,'A-01-IMPL-01');
  await admission.markPrepared(prepared);
  const checkpoint=JSON.parse(await readFile(join(taken.run_dir,'checkpoint.json'),'utf8'));
  assert.equal(checkpoint.phase,'READY_FOR_HANDOFF');
  assert.equal(checkpoint.current,'Await owner dispatch');
});
