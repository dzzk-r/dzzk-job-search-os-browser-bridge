export function conversationIdOf(event){
  const source=event?.source && typeof event.source==='object' ? event.source : {};
  const correlation=event?.correlation && typeof event.correlation==='object' ? event.correlation : {};
  const value=source.conversation_id ?? correlation.conversation_id ?? null;
  return typeof value==='string' && value.trim() ? value.trim() : null;
}

export function partitionTimeline(events,currentConversationId){
  const currentId=typeof currentConversationId==='string'&&currentConversationId.trim()?currentConversationId.trim():null;
  const current=[],other=[],unscoped=[];
  for(const event of events||[]){
    const id=conversationIdOf(event);
    if(!id) unscoped.push(event);
    else if(currentId && id===currentId) current.push(event);
    else other.push(event);
  }
  return {current,other,unscoped,all:[...(events||[])]};
}

export function conversationSummary(events){
  const counts=new Map();
  for(const event of events||[]){
    const id=conversationIdOf(event);
    if(!id) continue;
    counts.set(id,(counts.get(id)||0)+1);
  }
  return [...counts.entries()]
    .map(([conversation_id,event_count])=>({conversation_id,event_count}))
    .sort((a,b)=>b.event_count-a.event_count||a.conversation_id.localeCompare(b.conversation_id));
}

export function projectTimeline(events,{scope='current',currentConversationId=null}={}){
  const parts=partitionTimeline(events,currentConversationId);
  if(scope==='current') return parts.current;
  if(scope==='other') return parts.other;
  if(scope==='unscoped') return parts.unscoped;
  if(scope==='all') return parts.all;
  throw new Error('unknown conversation scope: '+scope);
}
