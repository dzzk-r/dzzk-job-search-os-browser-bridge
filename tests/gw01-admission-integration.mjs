import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConversationAdmission,admitTurn} from '../scripts/conversation-admission.mjs';
import {createTurnActionContext} from '../scripts/turn-action-context.mjs';
import {projectTimeline} from '../scripts/conversation-projection.mjs';

function makeContext(binding,turnId,corr){
  const turn=admitTurn(binding,{turn_id:turnId});
  return createTurnActionContext({
    client:turn.client,
    conversation_id:turn.conversation_id,
    turn_id:turn.turn_id,
    message_id:turn.message_id,
    action_label:'integration action',
    locator:turn.platform_locator,
    source_quality:turn.source_quality
  },{correlationId:corr});
}

test('GW-01 admitted turn creates correlation rooted in exactly one conversation',()=>{
  const a=normalizeConversationAdmission({client:'chatgpt-web',conversation_id:'chat-A'});
  const b=normalizeConversationAdmission({client:'chatgpt-web',conversation_id:'chat-B'});
  const ca=makeContext(a,'turn-A1','corr:A1');
  const cb=makeContext(b,'turn-B1','corr:B1');

  assert.equal(ca.source.conversation_id,'chat-A');
  assert.equal(cb.source.conversation_id,'chat-B');
  assert.notEqual(ca.correlation_id,cb.correlation_id);

  const events=[
    {source:ca.source,correlation:{conversation_id:ca.source.conversation_id,turn_id:ca.source.turn_id,correlation_id:ca.correlation_id},message:'A ACTION'},
    {source:cb.source,correlation:{conversation_id:cb.source.conversation_id,turn_id:cb.source.turn_id,correlation_id:cb.correlation_id},message:'B ACTION'},
    {source:ca.source,correlation:{conversation_id:ca.source.conversation_id,turn_id:ca.source.turn_id,correlation_id:ca.correlation_id},message:'A TERM'},
    {source:{client:'RDC',conversation_id:null,turn_id:null,source_quality:'transport_observed'},correlation:{correlation_id:null},message:'U RDC'},
    {source:cb.source,correlation:{conversation_id:cb.source.conversation_id,turn_id:cb.source.turn_id,correlation_id:cb.correlation_id},message:'B TERM'}
  ];

  assert.deepEqual(projectTimeline(events,{scope:'current',currentConversationId:'chat-A'}).map(e=>e.message),['A ACTION','A TERM']);
  assert.deepEqual(projectTimeline(events,{scope:'current',currentConversationId:'chat-B'}).map(e=>e.message),['B ACTION','B TERM']);
  assert.deepEqual(projectTimeline(events,{scope:'unscoped',currentConversationId:'chat-A'}).map(e=>e.message),['U RDC']);
});

test('GW-01 integration cannot change conversation after admission by overriding turn-action input',()=>{
  const binding=normalizeConversationAdmission({client:'chatgpt-web',conversation_id:'chat-A'});
  const turn=admitTurn(binding,{turn_id:'turn-A1'});
  assert.equal(turn.conversation_id,'chat-A');
  assert.throws(()=>admitTurn(binding,{conversation_id:'chat-B',turn_id:'turn-B1'}),/cannot change conversation binding/);
});
