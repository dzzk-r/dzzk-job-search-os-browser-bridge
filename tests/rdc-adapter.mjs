import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRdcAdapter} from '../server/rdc-adapter.mjs';

const task={task_id:'T-RDC-1',plan_id:'P-1',goal:'Make bounded repo change',scope:{reads:['README.md'],writes:['README.md'],tools:['read','edit','test']},acceptance:[{id:'A1',description:'tests pass'}],budget:{deadline_seconds:120}};

test('RDC adapter maps bounded task scope to a minimized tool capability set',async()=>{
  const root=await mkdtemp(join(tmpdir(),'edh-rdc-adapter-')), events=join(root,'observer.jsonl');
  const adapter=createRdcAdapter({repoRoot:root,root:join(root,'intents'),observerEventPath:events});
  const intent=await adapter.createIntent({task,baseline_commit:'abc'});
  assert.equal(intent.status,'AWAITING_CLAIM');
  assert.deepEqual(intent.capabilities.rdc_tools.sort(),['create_directory','edit_block','force_terminate','list_directory','read_file','read_multiple_files','read_process_output','start_process','write_file'].sort());
  assert.equal(intent.approval.state,'PENDING_EXTERNAL');
  assert.match(intent.correlation_id,/^corr:/);
  assert.match(intent.run_id,/^rdc-run:/);
});

test('RDC adapter enforces claim -> approval -> start -> tool evidence -> terminal result',async()=>{
  const root=await mkdtemp(join(tmpdir(),'edh-rdc-adapter-')), events=join(root,'observer.jsonl');
  const adapter=createRdcAdapter({repoRoot:root,root:join(root,'intents'),observerEventPath:events});
  let intent=await adapter.createIntent({task,conversation_id:'chat-1',turn_id:'turn-1'});
  intent=await adapter.claim(intent.intent_id,{adapter_id:'chatgpt',device_id:'dev-1'}); assert.equal(intent.status,'CLAIMED');
  await assert.rejects(()=>adapter.start(intent.intent_id),/approval must be APPROVED/);
  intent=await adapter.setApproval(intent.intent_id,'APPROVED'); assert.equal(intent.approval.state,'APPROVED');
  intent=await adapter.start(intent.intent_id,{device_id:'dev-1'}); assert.equal(intent.status,'RUNNING');
  await assert.rejects(()=>adapter.recordTool(intent.intent_id,{tool:'kill_process',phase:'START'}),/outside this task intent capability set/);
  await adapter.recordTool(intent.intent_id,{tool:'start_process',phase:'START',call_id:'call-1'});
  await adapter.recordTool(intent.intent_id,{tool:'start_process',phase:'DONE',call_id:'call-1',pid:123,duration_ms:25});
  intent=await adapter.complete(intent.intent_id,{outcome:'PASS',exit_code:0,artifacts:['README.md'],metrics:{elapsed_ms:50}});
  assert.equal(intent.status,'DONE'); assert.equal(intent.result.outcome,'PASS'); assert.equal(intent.metrics.tool_calls,1);
  const lines=(await readFile(events,'utf8')).trim().split('\n').map(JSON.parse).filter(x=>x.run_id===intent.run_id);
  assert.deepEqual(lines.map(x=>x.event),['INTENT_CREATED','START','START','DONE','DONE']);
  assert.ok(lines.every(x=>x.correlation_id===intent.correlation_id));
});
