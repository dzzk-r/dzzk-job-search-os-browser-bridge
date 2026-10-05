import test from 'node:test';
import assert from 'node:assert/strict';
import {createTurnActionContext} from '../scripts/turn-action-context.mjs';
import {partitionTimeline,projectTimeline,conversationSummary} from '../scripts/conversation-projection.mjs';

function evt(source,message,corr=null){
  return {
    source,
    message,
    correlation:corr?{
      correlation_id:corr.correlation_id,
      span_id:corr.action_span_id,
      parent_span_id:corr.turn_span_id,
      conversation_id:corr.source.conversation_id,
      turn_id:corr.source.turn_id,
      source_quality:corr.source.source_quality
    }:{correlation_id:null}
  };
}

test('GW-01 multi-chat projection keeps two interleaved conversations isolated',()=>{
  const a=createTurnActionContext({
    client:'chatgpt-web',conversation_id:'chat-A',turn_id:'turn-A1',
    action_label:'A action',source_quality:'transport_observed'
  },{correlationId:'corr:A1'});
  const b=createTurnActionContext({
    client:'chatgpt-web',conversation_id:'chat-B',turn_id:'turn-B1',
    action_label:'B action',source_quality:'transport_observed'
  },{correlationId:'corr:B1'});

  assert.notEqual(a.correlation_id,b.correlation_id);

  const events=[
    evt(a.source,'A CHAT START',a),
    evt(b.source,'B CHAT START',b),
    evt(a.source,'A MCP START',a),
    evt({client:'Remote Desktop Commander',conversation_id:null,turn_id:null,source_quality:'transport_observed'},'unscoped RDC read_file'),
    evt(b.source,'B TERM START',b),
    evt(a.source,'A QWEN START',a),
    evt(b.source,'B QWEN START',b),
    evt(a.source,'A DONE',a),
    evt(b.source,'B DONE',b)
  ];

  const pA=partitionTimeline(events,'chat-A');
  assert.deepEqual(pA.current.map(x=>x.message),['A CHAT START','A MCP START','A QWEN START','A DONE']);
  assert.deepEqual(pA.other.map(x=>x.message),['B CHAT START','B TERM START','B QWEN START','B DONE']);
  assert.deepEqual(pA.unscoped.map(x=>x.message),['unscoped RDC read_file']);

  const pB=partitionTimeline(events,'chat-B');
  assert.deepEqual(pB.current.map(x=>x.message),['B CHAT START','B TERM START','B QWEN START','B DONE']);
  assert.deepEqual(pB.other.map(x=>x.message),['A CHAT START','A MCP START','A QWEN START','A DONE']);
  assert.deepEqual(pB.unscoped.map(x=>x.message),['unscoped RDC read_file']);

  assert.equal(projectTimeline(events,{scope:'all',currentConversationId:'chat-A'}).length,9);
  assert.equal(projectTimeline(events,{scope:'unscoped',currentConversationId:'chat-A'}).length,1);
  assert.deepEqual(conversationSummary(events),[
    {conversation_id:'chat-A',event_count:4},
    {conversation_id:'chat-B',event_count:4}
  ]);
});

test('GW-01 never infers a conversation for unscoped evidence from time or current focus',()=>{
  const events=[
    {source:{client:'RDC',conversation_id:null,source_quality:'transport_observed'},message:'RDC at same timestamp',ts:100},
    {source:{client:'chatgpt-web',conversation_id:'chat-A',source_quality:'transport_observed'},message:'A event',ts:100}
  ];
  const p=partitionTimeline(events,'chat-A');
  assert.equal(p.current.length,1);
  assert.equal(p.unscoped.length,1);
  assert.equal(p.unscoped[0].message,'RDC at same timestamp');
});

test('GW-01 conversation projection is stable across reload/order-preserving replay',()=>{
  const events=[
    {source:{conversation_id:'chat-A'},message:'A1'},
    {source:{conversation_id:'chat-B'},message:'B1'},
    {source:{conversation_id:null},message:'U1'},
    {source:{conversation_id:'chat-A'},message:'A2'}
  ];
  const serialized=JSON.stringify(events);
  const replay=JSON.parse(serialized);
  assert.deepEqual(projectTimeline(replay,{scope:'current',currentConversationId:'chat-A'}).map(e=>e.message),['A1','A2']);
  assert.deepEqual(projectTimeline(replay,{scope:'other',currentConversationId:'chat-A'}).map(e=>e.message),['B1']);
  assert.deepEqual(projectTimeline(replay,{scope:'unscoped',currentConversationId:'chat-A'}).map(e=>e.message),['U1']);
});
