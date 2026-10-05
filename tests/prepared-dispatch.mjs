import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createPreparedDispatch } from '../server/prepared-dispatch.mjs';

test('prepared dispatch launches only a READY bounded envelope and becomes DISPATCHED', async () => {
  const root=await mkdtemp(join(tmpdir(),'edh-prepared-'));
  const work=join(root,'WORK');
  const repo=join(work,'repo');
  const run=join(work,'runs','one');
  await mkdir(repo,{recursive:true});
  await mkdir(run,{recursive:true});
  const context=join(run,'context.json');
  const task=join(run,'task.json');
  const statePath=join(root,'state','prepared.json');
  const runner=join(repo,'runner.mjs');
  await writeFile(context,JSON.stringify({client:'chatgpt-web',conversation_id:null,turn_id:null,action_label:'Prepared acceptance'})+'\n');
  await writeFile(task,JSON.stringify({task_id:'T-1',goal:'bounded acceptance'})+'\n');
  await writeFile(runner,"process.stdout.write(JSON.stringify({controller_id:'detached:test',pid:1234})+'\\n');\n");
  await mkdir(join(root,'state'),{recursive:true});
  await writeFile(statePath,JSON.stringify({
    schema_version:'1.0',status:'READY',label:'Prepared acceptance',goal:'bounded acceptance',
    task_id:'T-1',context_path:context,task_path:task,run_dir:run,prepared_at:'2026-10-05T00:00:00Z'
  })+'\n');

  const dispatch=createPreparedDispatch({repoRoot:repo,workRoot:work,statePath,runner});
  const before=await dispatch.state();
  assert.equal(before.ready,true);
  assert.equal(before.task_id,'T-1');

  await assert.rejects(()=>dispatch.dispatch(),/Conversation admission is required/);
  const result=await dispatch.dispatch({
    client:'chatgpt-web',conversation_id:'chat-A',binding_id:'convbind:A',
    platform_locator:'chatgpt-tab:8',source_quality:'declared'
  });
  assert.equal(result.status,'DISPATCHED');
  assert.equal(result.conversation_id,'chat-A');
  assert.match(result.turn_id,/^turn:/);
  assert.equal(result.binding_id,'convbind:A');
  assert.equal(result.controller_id,'detached:test');
  assert.equal(result.pid,1234);

  const after=JSON.parse(await readFile(statePath,'utf8'));
  assert.equal(after.status,'DISPATCHED');
  assert.equal(after.controller_id,'detached:test');
  assert.equal(after.conversation_id,'chat-A');
  assert.match(after.turn_id,/^turn:/);
  assert.equal(after.binding_id,'convbind:A');
  const original=JSON.parse(await readFile(context,'utf8'));
  assert.equal(original.conversation_id,null);
  assert.equal(original.turn_id,null);
  const admitted=JSON.parse(await readFile(after.admitted_context_path,'utf8'));
  assert.equal(admitted.conversation_id,'chat-A');
  assert.equal(admitted.turn_id,after.turn_id);
  assert.equal(admitted.binding_id,'convbind:A');
  assert.equal(admitted.locator,'chatgpt-tab:8');
  assert.equal((await dispatch.state()).ready,false);
});

test('prepared dispatch rejects paths outside its work root', async () => {
  const root=await mkdtemp(join(tmpdir(),'edh-prepared-outside-'));
  const work=join(root,'WORK');
  const repo=join(work,'repo');
  await mkdir(repo,{recursive:true});
  const statePath=join(root,'prepared.json');
  await writeFile(statePath,JSON.stringify({
    schema_version:'1.0',status:'READY',label:'Bad',goal:'Bad',
    context_path:'/tmp/outside-context.json',task_path:'/tmp/outside-task.json',run_dir:'/tmp/outside-run'
  })+'\n');
  const dispatch=createPreparedDispatch({repoRoot:repo,workRoot:work,statePath,runner:join(repo,'runner.mjs')});
  await assert.rejects(()=>dispatch.state(),/outside the allowed work root/);
});


test('prepared dispatch rejects a conversation binding conflict before execution', async () => {
  const root=await mkdtemp(join(tmpdir(),'edh-prepared-conflict-'));
  const work=join(root,'WORK'), repo=join(work,'repo'), run=join(work,'runs','one');
  await mkdir(repo,{recursive:true}); await mkdir(run,{recursive:true});
  const context=join(run,'context.json'), task=join(run,'task.json'), statePath=join(root,'state','prepared.json'), runner=join(repo,'runner.mjs');
  await writeFile(context,JSON.stringify({client:'chatgpt-web',conversation_id:'chat-B',turn_id:null,action_label:'Conflict'})+'\n');
  await writeFile(task,JSON.stringify({task_id:'T-X',goal:'conflict'})+'\n');
  await writeFile(runner,"process.stdout.write(JSON.stringify({controller_id:'must-not-run',pid:1})+'\\n');\n");
  await mkdir(join(root,'state'),{recursive:true});
  await writeFile(statePath,JSON.stringify({
    schema_version:'1.0',status:'READY',label:'Conflict',goal:'conflict',task_id:'T-X',
    context_path:context,task_path:task,run_dir:run,prepared_at:'2026-10-05T00:00:00Z'
  })+'\n');
  const dispatch=createPreparedDispatch({repoRoot:repo,workRoot:work,statePath,runner});
  await assert.rejects(
    ()=>dispatch.dispatch({client:'chatgpt-web',conversation_id:'chat-A',binding_id:'convbind:A'}),
    /already bound to another conversation/
  );
  assert.equal((await dispatch.state()).ready,true);
});
