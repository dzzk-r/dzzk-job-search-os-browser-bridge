import test from 'node:test';
import assert from 'node:assert/strict';
import {createTurnActionContext} from '../scripts/turn-action-context.mjs';

test('turn/action context allocates one causal root before execution',()=>{
  const ctx=createTurnActionContext({
    client:'chatgpt-web',
    conversation_id:'conv-1',
    turn_id:'turn-1',
    message_id:'msg-1',
    action_label:'Run gateway acceptance'
  },{correlationId:'corr:test'});
  assert.equal(ctx.correlation_id,'corr:test');
  assert.equal(ctx.source.conversation_id,'conv-1');
  assert.equal(ctx.source.turn_id,'turn-1');
  assert.equal(ctx.source.message_id,'msg-1');
  assert.equal(ctx.action_label,'Run gateway acceptance');
  assert.equal(ctx.turn_span_id,'turn:corr:test');
  assert.match(ctx.action_span_id,/^turn:corr:test:action:/);
});

test('turn/action context requires explicit human-readable source identity',()=>{
  assert.throws(()=>createTurnActionContext({client:'chatgpt-web',conversation_id:'c',turn_id:'t'}),/action_label is required/);
});
