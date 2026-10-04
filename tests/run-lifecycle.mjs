import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startLifecycle, updateLifecycle, readLifecycle } from '../scripts/run-lifecycle.mjs';

test('run lifecycle keeps JSON snapshot and append-only JSONL transitions', async () => {
  const root=await mkdtemp(join(tmpdir(),'edh-lifecycle-'));
  const run=join(root,'run-1'), state=join(root,'current-run.json');
  try {
    await startLifecycle(run,{
      run_id:'run-1',plan_id:'plan-1',task_id:'task-1',goal:'Fix help',
      phase:'PLANNING',completed:[],current:'Generate task',pending:['Validate','Persist'],
      budget:{deadline_seconds:300},safe_to_interrupt:'no'
    },{stateFile:state});
    await updateLifecycle(run,{
      phase:'VALIDATING',completed:['proposal_generated'],current:'Validate task',
      pending:['Persist'],safe_to_interrupt:'after_checkpoint'
    },{type:'PROGRESS',stateFile:state});
    await updateLifecycle(run,{
      status:'DONE',phase:'TASK_READY',completed:['proposal_generated','task_validated','task_persisted'],
      current:null,pending:[],safe_to_interrupt:'yes',last_durable_checkpoint:'task.json'
    },{type:'DONE',stateFile:state});

    const snapshot=await readLifecycle(run);
    assert.equal(snapshot.status,'DONE');
    assert.equal(snapshot.safe_to_interrupt,'yes');
    assert.deepEqual(snapshot.pending,[]);
    assert.equal(snapshot.last_durable_checkpoint,'task.json');

    const lines=(await readFile(join(run,'lifecycle.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(lines.map(x=>x.type),['START','PROGRESS','DONE']);
    assert.ok(lines.every(x=>x.run_id==='run-1'&&x.task_id==='task-1'));

    const pointer=JSON.parse(await readFile(state,'utf8'));
    assert.equal(pointer.run_id,'run-1');
    assert.equal(pointer.status,'DONE');
    assert.equal(pointer.safe_to_interrupt,'yes');
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});
