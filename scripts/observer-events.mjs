import {appendFile,mkdir} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';

export const DEFAULT_OBSERVER_EVENTS=join(homedir(),'.local','state','execution-delivery-harness','observer-events.jsonl');

export function newCorrelationId(){ return 'corr:'+randomUUID(); }

function cleanSource(source={}) {
  return {
    client:source.client??null,
    conversation_id:source.conversation_id??null,
    turn_id:source.turn_id??null,
    message_id:source.message_id??null,
    action_id:source.action_id??null,
    action_label:source.action_label??null,
    locator:source.locator??null,
    source_quality:source.source_quality??'declared'
  };
}

export async function appendObserverEvent({
  actor,event,correlation_id=null,run_id=null,plan_id=null,task_id=null,parent_span_id=null,span_id=null,
  message='',source={},meta={}
},{path=DEFAULT_OBSERVER_EVENTS}={}) {
  const value={
    schema_version:'1.0',
    ts:new Date().toISOString(),
    actor,
    event,
    correlation_id,
    run_id,
    plan_id,
    task_id,
    span_id:span_id||[run_id,actor,event].filter(Boolean).join(':'),
    parent_span_id,
    message,
    source:cleanSource(source),
    meta
  };
  await mkdir(dirname(path),{recursive:true});
  await appendFile(path,JSON.stringify(value)+'\n');
  return value;
}
