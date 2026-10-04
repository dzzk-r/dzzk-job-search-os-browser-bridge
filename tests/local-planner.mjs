import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleTaskEnvelope } from '../scripts/local-planner.mjs';
import { validatePlanningDocument } from '../scripts/planning-contract.mjs';

const request={
  plan_id:'plan-1',
  task_id:'task-1',
  goal:'Improve observer progress truth',
  evidence:[{kind:'repo',locator:'TODO.md#OBS-06',summary:'Waiting state lacks remaining work'}],
  scope:{reads:['TODO.md','chrome/observer.js'],writes:['chrome/observer.js'],tools:['read','edit','test']},
  constraints:['Do not change OAuth'],
  non_goals:['Do not redesign all observer state'],
  budget:{deadline_seconds:300,max_agent_steps:6,max_output_tokens:1800,max_repairs:1},
  artifacts:{run_dir:'runs/plan-1/task-1',expected:['report.json']},
  source:{client:'chatgpt-web',conversation_id:'conv-1',turn_id:'turn-1',message_id:null,locator:null},
  execution_profile:{executor:'opencode',provider:'llamacpp',model:'qwen3.8-27b',runtime:'llama.cpp'}
};

const proposal={
  goal:'Add a compact progress checkpoint to the observer state',
  acceptance:[{id:'a1',description:'Observer test passes',evidence_required:'Harness verifier records a passing observer test result'}],
  risk_class:'low',
  escalation_conditions:['Required state cannot be derived without changing gateway contract']
};

test('planner proposal is assembled inside Harness-owned boundaries',async()=>{
  const envelope=assembleTaskEnvelope(request,proposal);
  assert.deepEqual(envelope.scope,request.scope);
  assert.deepEqual(envelope.source,request.source);
  assert.deepEqual(envelope.execution_profile,request.execution_profile);
  assert.deepEqual(envelope.budget,request.budget);
  await validatePlanningDocument('task',envelope);
});

test('planner cannot widen the envelope with model-supplied fields',()=>{
  assert.throws(()=>assembleTaskEnvelope(request,{...proposal,scope:{writes:['/']}}),/may not set this field/);
});

test('planner cannot emit an invalid task contract',async()=>{
  const envelope=assembleTaskEnvelope(request,{...proposal,acceptance:[]});
  await assert.rejects(validatePlanningDocument('task',envelope),/too few items/);
});
