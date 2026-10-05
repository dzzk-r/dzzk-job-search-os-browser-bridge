(() => {
  if (globalThis.__EDH_CHAT_CONTEXT_V3__) return;
  globalThis.__EDH_CHAT_CONTEXT_V3__=true;

  const USER='[data-message-author-role="user"]';
  const ASSISTANT='[data-message-author-role="assistant"]';
  const HEARTBEAT_MS=3000;
  const DONE_QUIET_MS=1800;
  const MAX_TURN_MS=15*60*1000;

  function conversationIdFromLocation() {
    try {
      const u=new URL(location.href);
      if(u.protocol!=='https:' || !(u.hostname==='chatgpt.com'||u.hostname.endsWith('.chatgpt.com'))) return null;
      const parts=u.pathname.split('/').filter(Boolean);
      const at=parts.lastIndexOf('c');
      const id=at>=0 ? parts[at+1] : null;
      return typeof id==='string' && /^[A-Za-z0-9_-]{6,160}$/.test(id) ? id : null;
    } catch { return null; }
  }

  const count=selector=>document.querySelectorAll(selector).length;
  const generating=()=>Boolean(
    document.querySelector('button[data-testid*="stop"],button[aria-label*="Stop"],button[aria-label*="stop"],button[aria-label*="Cancel"],button[aria-label*="cancel"]')
  );
  const send=message=>chrome.runtime.sendMessage(message).catch(()=>{});

  let contextSignature='';
  let conversationId=null;
  let initialized=false;
  let lastUserCount=0;
  let lastAssistantCount=0;
  let activeTurn=null;
  let lastDetectorStatusAt=0;

  function publishContext() {
    const id=conversationIdFromLocation();
    const signature=(id||'')+'|'+location.href+'|'+(document.title||'');
    if(signature!==contextSignature) {
      contextSignature=signature;
      send({
        type:'chat-context-observed',
        conversation_id:id,
        url:location.href,
        title:document.title||'',
        observed_at:new Date().toISOString()
      });
    }
    if(id!==conversationId) {
      if(activeTurn) {
        sendTurn('DONE','navigation');
        activeTurn=null;
      }
      conversationId=id;
      initialized=false;
    }
  }

  function sendTurn(phase,reason=null) {
    if(!activeTurn || !conversationId) return;
    send({
      type:'chat-turn-observed',
      detector_version:'turn-v3',
      phase,
      conversation_id:conversationId,
      turn_id:activeTurn.id,
      url:location.href,
      title:document.title||'',
      observed_at:new Date().toISOString(),
      reason,
      user_count:lastUserCount,
      assistant_count:lastAssistantCount
    });
  }

  function startTurn(now,userCount,assistantCount,reason='composer-submit') {
    activeTurn={
      id:'browser:'+conversationId+':'+crypto.randomUUID(),
      startedAt:now,
      assistantBaseline:assistantCount,
      assistantSeen:false,
      activePublished:false,
      sawGenerating:false,
      lastGeneratingAt:0,
      lastAssistantMutationAt:now,
      lastHeartbeatAt:0
    };
    lastUserCount=userCount;
    lastAssistantCount=assistantCount;
    sendTurn('START',reason);
  }

  function noteAssistantMutation(target) {
    if(!activeTurn) return;
    const el=target?.nodeType===Node.ELEMENT_NODE ? target : target?.parentElement;
    if(el?.closest?.(ASSISTANT)) activeTurn.lastAssistantMutationAt=Date.now();
  }

  function structuralNames() {
    const testids={};
    for(const el of document.querySelectorAll('[data-testid]')) {
      const key=String(el.getAttribute('data-testid')||'').slice(0,120);
      if(key) testids[key]=(testids[key]||0)+1;
      if(Object.keys(testids).length>=80) break;
    }
    const roles={};
    for(const el of document.querySelectorAll('[role]')) {
      const key=String(el.getAttribute('role')||'').slice(0,80);
      if(key) roles[key]=(roles[key]||0)+1;
    }
    const editor=document.querySelector('[contenteditable="true"]');
    const form=editor?.closest?.('form')||null;
    const composer={
      has_editor:Boolean(editor),
      has_form:Boolean(form),
      form_buttons:form ? [...form.querySelectorAll('button')].slice(0,20).map(b=>({
        type:b.getAttribute('type'),
        aria_label:b.getAttribute('aria-label'),
        data_testid:b.getAttribute('data-testid'),
        disabled:b.disabled===true
      })) : []
    };
    return {testids,roles,composer};
  }

  function publishDetectorStatus(now,userCount,assistantCount) {
    const statusInterval=activeTurn ? 3000 : 15000;
    if(now-lastDetectorStatusAt<statusInterval) return;
    lastDetectorStatusAt=now;
    const structure=structuralNames();
    send({
      type:'chat-detector-status',
      detector_version:'turn-v3',
      conversation_id:conversationId,
      url:location.href,
      title:document.title||'',
      observed_at:new Date().toISOString(),
      user_count:userCount,
      assistant_count:assistantCount,
      generating:generating(),
      active_turn_id:activeTurn?.id||null,
      structural_counts:{
        article:count('article'),
        conversation_turn:count('[data-testid^="conversation-turn"]'),
        message_role:count('[data-message-author-role]'),
        message_id:count('[data-message-id]'),
        turn_id:count('[data-turn-id]'),
        send_control:count('button[data-testid*="send"]'),
        stop_control:count('button[data-testid*="stop"]'),
        body_children:document.body?.children?.length||0,
        div:count('div'),
        main:count('main'),
        iframe:count('iframe'),
        contenteditable:count('[contenteditable="true"]'),
        button:count('button'),
        testids:structure.testids,
        roles:structure.roles,
        composer:structure.composer
      }
    });
  }

  function scanTurn() {
    publishContext();
    if(!conversationId) return;
    const now=Date.now();
    const userCount=count(USER);
    const assistantCount=count(ASSISTANT);
    publishDetectorStatus(now,userCount,assistantCount);

    if(!initialized) {
      initialized=true;
      lastUserCount=userCount;
      lastAssistantCount=assistantCount;
      if(generating()) {
        startTurn(now,userCount,assistantCount,'attached-during-generation');
        activeTurn.sawGenerating=true;
        activeTurn.lastGeneratingAt=now;
        activeTurn.activePublished=true;
        sendTurn('ACTIVE','generating-control-present');
      }
      return;
    }

    if(!activeTurn && userCount>lastUserCount) {
      startTurn(now,userCount,assistantCount,'user-message-node-added-fallback');
    }
    lastUserCount=userCount;
    lastAssistantCount=assistantCount;
    if(!activeTurn) return;

    const isGenerating=generating();
    if(isGenerating) {
      activeTurn.sawGenerating=true;
      activeTurn.lastGeneratingAt=now;
      if(!activeTurn.activePublished) {
        activeTurn.activePublished=true;
        sendTurn('ACTIVE','generating-control-present');
      }
    } else if(assistantCount>activeTurn.assistantBaseline) {
      activeTurn.assistantSeen=true;
      if(!activeTurn.activePublished) {
        activeTurn.activePublished=true;
        activeTurn.lastAssistantMutationAt=now;
        sendTurn('ACTIVE','assistant-message-node-added-fallback');
      }
    }

    if(now-activeTurn.lastHeartbeatAt>=HEARTBEAT_MS) {
      activeTurn.lastHeartbeatAt=now;
      sendTurn('HEARTBEAT');
    }

    const generationSettled=activeTurn.sawGenerating && !isGenerating && now-activeTurn.lastGeneratingAt>=DONE_QUIET_MS;
    const assistantSettled=!activeTurn.sawGenerating && activeTurn.assistantSeen && !isGenerating && now-activeTurn.lastAssistantMutationAt>=DONE_QUIET_MS;
    if(generationSettled || assistantSettled) {
      sendTurn('DONE',generationSettled?'generating-control-cleared':'assistant-settled-fallback');
      activeTurn=null;
      return;
    }
    if(now-activeTurn.startedAt>=MAX_TURN_MS) {
      sendTurn('DONE','max-observation-window');
      activeTurn=null;
    }
  }

  document.addEventListener('submit',event=>{
    const form=event.target;
    if(!(form instanceof HTMLFormElement) || !form.querySelector('[contenteditable="true"]')) return;
    publishContext();
    if(!conversationId) return;
    const now=Date.now();
    const userCount=count(USER), assistantCount=count(ASSISTANT);
    if(activeTurn) {
      sendTurn('DONE','superseded-by-composer-submit');
      activeTurn=null;
    }
    startTurn(now,userCount,assistantCount,'composer-submit');
    queueMicrotask(scanTurn);
  },true);

  publishContext();
  scanTurn();
  const observer=new MutationObserver(mutations=>{
    for(const mutation of mutations) noteAssistantMutation(mutation.target);
    scanTurn();
  });
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  addEventListener('popstate',scanTurn);
  addEventListener('hashchange',scanTurn);
  addEventListener('pagehide',()=>{ if(activeTurn) sendTurn('DONE','pagehide'); });
  setInterval(scanTurn,1000);
})();
