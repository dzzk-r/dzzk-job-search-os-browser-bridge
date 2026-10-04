import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePlanningDocument } from '../scripts/planning-contract.mjs';

const task = {
  schema_version:'1.0',
  task_id:'task-1',
  plan_id:'plan-1',
  goal:'Implement one bounded observer change',
  evidence:[{kind:'repo',locator:'TODO.md#OBS-06',summary:'Progress contract is tracked'}],
  scope:{reads:['TODO.md'],writes:['chrome/observer.js'],tools:['read','edit','test']},
  constraints:['Do not change OAuth policy'],
  non_goals:['Do not redesign the whole Observer'],
  acceptance:[{id:'a1',description:'Focused tests pass',evidence_required:'Harness verifier records a passing focused test result'}],
  risk_class:'low',
  budget:{deadline_seconds:300,max_agent_steps:6,max_output_tokens:1800,max_repairs:1},
  escalation_conditions:['Public contract must change','Bounded repair failed'],
  artifacts:{run_dir:'runs/plan-1/task-1',expected:['report.json']},
  source:{client:'chatgpt-web',conversation_id:'conv-1',turn_id:'turn-1',message_id:null,locator:null},
  execution_profile:{executor:'opencode',provider:'llamacpp',model:'qwen3.8-27b',runtime:'llama.cpp'}
};

const escalation = {
  schema_version:'1.0',
  escalation_id:'esc-1',
  plan_id:'plan-1',
  task_id:'task-1',
  trigger:'architectural_ambiguity',
  decision_required:'Choose ownership boundary for correlation IDs',
  evidence:[{locator:'docs/OBSERVER-ARCHITECTURE.md',summary:'Gateway is current source of truth'}],
  attempted:['Compared current observer and gateway contracts'],
  options:[
    {id:'A',description:'Gateway owns IDs',tradeoffs:'Single source of truth'},
    {id:'B',description:'Observer owns IDs',tradeoffs:'Competing provenance source'}
  ],
  recommended_local_choice:'A',
  exact_question:'Should correlation identity remain gateway-owned?',
  artifacts:['runs/plan-1/task-1/report.json'],
  source:{client:'local-planner',conversation_id:null,turn_id:null,message_id:null,locator:'plan-1/task-1'}
};

test('planning contracts accept representative task and escalation documents', async () => {
  await validatePlanningDocument('task',task);
  await validatePlanningDocument('escalation',escalation);
});

test('task envelope rejects missing acceptance and unknown scope expansion', async () => {
  const missing=structuredClone(task); delete missing.acceptance;
  await assert.rejects(validatePlanningDocument('task',missing),/acceptance.*required/);
  const expanded=structuredClone(task); expanded.scope.shell_root='/';
  await assert.rejects(validatePlanningDocument('task',expanded),/additional property/);
});

test('planning enums reject invented risk and escalation trigger values', async () => {
  const badTask=structuredClone(task); badTask.risk_class='whatever';
  await assert.rejects(validatePlanningDocument('task',badTask),/enum/);
  const badEsc=structuredClone(escalation); badEsc.trigger='ask_chatgpt_every_time';
  await assert.rejects(validatePlanningDocument('escalation',badEsc),/enum/);
});
