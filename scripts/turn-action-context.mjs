import {randomUUID} from 'node:crypto';
import {newCorrelationId} from './observer-events.mjs';

function required(value,name){
  if(typeof value!=='string'||!value.trim()) throw new Error(name+' is required');
  return value.trim();
}

export function createTurnActionContext(input={}, {correlationId}={}) {
  const client=required(input.client,'client');
  const conversation_id=required(input.conversation_id,'conversation_id');
  const turn_id=required(input.turn_id,'turn_id');
  const action_label=required(input.action_label,'action_label');
  const message_id=typeof input.message_id==='string'&&input.message_id.trim()?input.message_id.trim():null;
  const action_id=typeof input.action_id==='string'&&input.action_id.trim()?input.action_id.trim():'action:'+randomUUID();
  const correlation_id=correlationId||input.correlation_id||newCorrelationId();
  const turn_span_id='turn:'+correlation_id;
  const action_span_id=turn_span_id+':'+action_id;
  const source={
    client,
    conversation_id,
    turn_id,
    message_id,
    action_id,
    action_label,
    locator:typeof input.locator==='string'?input.locator:null,
    source_quality:input.source_quality==='transport_observed'?'transport_observed':'declared'
  };
  return {
    schema_version:'1.0',
    correlation_id,
    turn_span_id,
    action_span_id,
    action_id,
    action_label,
    source
  };
}
