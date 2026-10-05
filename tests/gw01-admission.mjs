import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConversationAdmission,admitTurn,sameConversation} from '../scripts/conversation-admission.mjs';

test('GW-01 admission gives one stable binding per client conversation',()=>{
  const a1=normalizeConversationAdmission({client:'chatgpt-web',conversation_id:'chat-A',platform_locator:'chatgpt:project/x/chat/A',source_quality:'transport_observed'});
  const a2=normalizeConversationAdmission({client:'chatgpt-web',conversation_id:'chat-A',platform_locator:'chatgpt:project/x/chat/A',source_quality:'transport_observed'});
  const b=normalizeConversationAdmission({client:'chatgpt-web',conversation_id:'chat-B',platform_locator:'chatgpt:project/x/chat/B',source_quality:'transport_observed'});
  assert.equal(a1.binding_id,a2.binding_id);
  assert.notEqual(a1.binding_id,b.binding_id);
  assert.equal(sameConversation(a1,a2),true);
  assert.equal(sameConversation(a1,b),false);
});

test('GW-01 admission preserves conversation across multiple turns while allocating distinct turn roots',()=>{
  const binding=normalizeConversationAdmission({client:'chatgpt-web',conversation_id:'chat-A'});
  const t1=admitTurn(binding,{turn_id:'turn-A1'});
  const t2=admitTurn(binding,{turn_id:'turn-A2'});
  assert.equal(t1.conversation_id,'chat-A');
  assert.equal(t2.conversation_id,'chat-A');
  assert.notEqual(t1.turn_id,t2.turn_id);
  assert.equal(t1.binding_id,t2.binding_id);
});

test('GW-01 rejects cross-chat turn rebinding before dispatch',()=>{
  const binding=normalizeConversationAdmission({client:'chatgpt-web',conversation_id:'chat-A'});
  assert.throws(()=>admitTurn(binding,{conversation_id:'chat-B',turn_id:'turn-B1'}),/cannot change conversation binding/);
});

test('platform locator is optional evidence, not the conversation identity',()=>{
  const a=normalizeConversationAdmission({client:'chatgpt-web',conversation_id:'chat-A'});
  assert.equal(a.platform_locator,null);
  assert.equal(a.conversation_id,'chat-A');
  const t=admitTurn(a,{turn_id:'turn-A1'});
  assert.equal(t.conversation_id,'chat-A');
});
