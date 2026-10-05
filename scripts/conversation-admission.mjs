import {createHash,randomUUID} from 'node:crypto';

function req(v,n){
  if(typeof v!=='string'||!v.trim()) throw new Error(n+' is required');
  return v.trim();
}
export function normalizeConversationAdmission(input={}){
  const client=req(input.client,'client');
  const conversation_id=req(input.conversation_id,'conversation_id');
  const platform_locator=typeof input.platform_locator==='string'&&input.platform_locator.trim()?input.platform_locator.trim():null;
  const source_quality=input.source_quality==='transport_observed'?'transport_observed':'declared';
  const binding_material=client+'\n'+conversation_id+'\n'+(platform_locator||'');
  const binding_id='convbind:'+createHash('sha256').update(binding_material).digest('hex').slice(0,24);
  return {
    schema_version:'1.0',
    binding_id,
    client,
    conversation_id,
    platform_locator,
    source_quality
  };
}

export function admitTurn(binding,input={}){
  if(!binding?.binding_id) throw new Error('conversation binding is required');
  const requested=input.conversation_id??binding.conversation_id;
  if(requested!==binding.conversation_id) throw new Error('turn cannot change conversation binding');
  const turn_id=typeof input.turn_id==='string'&&input.turn_id.trim()?input.turn_id.trim():'turn:'+randomUUID();
  const message_id=typeof input.message_id==='string'&&input.message_id.trim()?input.message_id.trim():null;
  return {
    schema_version:'1.0',
    binding_id:binding.binding_id,
    client:binding.client,
    conversation_id:binding.conversation_id,
    turn_id,
    message_id,
    platform_locator:binding.platform_locator,
    source_quality:binding.source_quality
  };
}

export function sameConversation(a,b){
  return Boolean(a?.binding_id && b?.binding_id && a.binding_id===b.binding_id && a.conversation_id===b.conversation_id);
}
