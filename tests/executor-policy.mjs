import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createExecutorPolicy } from '../server/executor-policy.mjs';

test('executor policy persists AUTO/EDH/RDC/COMPARE and rejects unknown modes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'edh-executor-policy-'));
  const policy=createExecutorPolicy({statePath:join(root,'state.json'),compareRoot:join(root,'compare')});
  assert.equal((await policy.state()).mode,'AUTO');
  for(const mode of ['EDH','RDC','COMPARE','AUTO']) assert.equal((await policy.setMode(mode)).mode,mode);
  await assert.rejects(()=>policy.setMode('MAGIC'),/AUTO, EDH, RDC or COMPARE/);
});

test('COMPARE creates two sibling run plans from one task envelope and baseline',async()=>{
  const root=await mkdtemp(join(tmpdir(),'edh-compare-plan-'));
  const policy=createExecutorPolicy({statePath:join(root,'state.json'),compareRoot:join(root,'compare')});
  const task={task_id:'T-42',plan_id:'P-1',goal:'Fix one thing',acceptance:[{id:'A1',description:'tests pass'}],budget:{deadline_seconds:120}};
  const plan=await policy.createComparisonPlan({task,baseline_commit:'abc123',source_run_dir:'/tmp/source'});
  assert.equal(plan.status,'PLANNED');
  assert.equal(plan.runs.length,2);
  assert.deepEqual(plan.runs.map(x=>x.executor),['EDH','RDC']);
  assert.equal(plan.baseline_commit,'abc123');
  assert.deepEqual(plan.runs.map(x=>x.status),['PLANNED','PLANNED']);
  const persisted=JSON.parse(await readFile(join(root,'compare',plan.comparison_id.replace(':','-'),'comparison.json'),'utf8'));
  assert.equal(persisted.task_id,'T-42');
  assert.deepEqual(persisted.acceptance,task.acceptance);
});


test('RDC dispatch intent is durable and explicitly external rather than pretending to execute',async()=>{
  const root=await mkdtemp(join(tmpdir(),'edh-rdc-intent-'));
  const policy=createExecutorPolicy({statePath:join(root,'state.json'),compareRoot:join(root,'compare'),intentRoot:join(root,'intents')});
  const intent=await policy.createDispatchIntent({task:{task_id:'T-RDC',plan_id:'P',goal:'same task',acceptance:[]},executor:'RDC',baseline_commit:'deadbeef',conversation_id:'chat-1',turn_id:'turn-1'});
  assert.equal(intent.status,'AWAITING_EXTERNAL_EXECUTOR');
  assert.equal(intent.executor,'RDC');
  const persisted=JSON.parse(await readFile(join(root,'intents',intent.intent_id.replace(':','-')+'.json'),'utf8'));
  assert.equal(persisted.baseline_commit,'deadbeef');
  assert.equal(persisted.turn_id,'turn-1');
});
