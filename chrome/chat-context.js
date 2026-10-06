(() => {
  if (globalThis.__EDH_CHAT_CONTEXT_V5__) return;
  globalThis.__EDH_CHAT_CONTEXT_V5__=true;

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
  const RESPONSE_ACTION_SELECTOR=[
    'button[aria-label*="Good response" i]',
    'button[aria-label*="Bad response" i]',
    'button[aria-label*="Read aloud" i]',
    'button[aria-label*="Regenerate" i]',
    'button[data-testid*="good-response" i]',
    'button[data-testid*="bad-response" i]'
  ].join(',');
  const responseActionCount=()=>document.querySelectorAll(RESPONSE_ACTION_SELECTOR).length;
  function composerReady() {
    const editor=document.querySelector('[contenteditable="true"]');
    const form=editor?.closest?.('form')||null;
    const submit=form?.querySelector('button[type="submit"]')||null;
    return Boolean(editor && form && submit && submit.disabled!==true && submit.getAttribute('aria-disabled')!=='true');
  }
  const send=message=>chrome.runtime.sendMessage(message).catch(()=>{});

  function visible(el) {
    if(!el) return false;
    const style=getComputedStyle(el);
    return style.display!=='none' && style.visibility!=='hidden' && el.getClientRects().length>0;
  }
  function approvalGatePresent() {
    const dialogs=[...document.querySelectorAll('[role="dialog"],[role="alertdialog"],dialog[open]')];
    return dialogs.some(dialog=>{
      if(!visible(dialog)) return false;
      const controls=[...dialog.querySelectorAll('button,[role="button"],input,select,textarea')].filter(visible);
      return controls.length>=2;
    });
  }
  function turnActivityState(now,isGenerating=generating()) {
    if(!activeTurn) return 'idle';
    if(approvalGatePresent()) return 'waiting_user';
    if(isGenerating) return 'active';
    if(now-(activeTurn.lastAssistantMutationAt||0)<=2000) return 'active';
    return 'pending';
  }

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
      detector_version:'turn-v5',
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
      lastHeartbeatAt:0,
      responseActionBaseline:responseActionCount(),
      completionCandidateSince:0
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
      ready:composerReady(),
      form_buttons:form ? [...form.querySelectorAll('button')].slice(0,20).map(b=>({
        type:b.getAttribute('type'),
        aria_label:b.getAttribute('aria-label'),
        data_testid:b.getAttribute('data-testid'),
        disabled:b.disabled===true
      })) : []
    };
    return {testids,roles,composer,response_action_controls:responseActionCount()};
  }

  function publishDetectorStatus(now,userCount,assistantCount) {
    const statusInterval=activeTurn ? 3000 : 15000;
    if(now-lastDetectorStatusAt<statusInterval) return;
    lastDetectorStatusAt=now;
    const structure=structuralNames();
    send({
      type:'chat-detector-status',
      detector_version:'turn-v5',
      conversation_id:conversationId,
      url:location.href,
      title:document.title||'',
      observed_at:new Date().toISOString(),
      user_count:userCount,
      assistant_count:assistantCount,
      generating:generating(),
      active_turn_id:activeTurn?.id||null,
      activity_state:turnActivityState(now),
      waiting_user:approvalGatePresent(),
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
        composer:structure.composer,
        response_action_controls:structure.response_action_controls,
        dialog:count('[role="dialog"]'),
        alertdialog:count('[role="alertdialog"]'),
        open_dialog:count('dialog[open]'),
        response_action_baseline:activeTurn?.responseActionBaseline??null,
        completion_evidence:Boolean(activeTurn && structure.response_action_controls>activeTurn.responseActionBaseline),
        completion_candidate_ms:activeTurn?.completionCandidateSince?Math.max(0,now-activeTurn.completionCandidateSince):0
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

    const isGenerating=generating();
    if(!activeTurn && userCount>lastUserCount) {
      startTurn(now,userCount,assistantCount,'user-message-node-added-fallback');
    }
    if(!activeTurn && isGenerating) {
      startTurn(now,userCount,assistantCount,'generating-without-active-turn-recovery');
      activeTurn.sawGenerating=true;
      activeTurn.lastGeneratingAt=now;
      activeTurn.activePublished=true;
      sendTurn('ACTIVE','generating-control-present');
    }
    lastUserCount=userCount;
    lastAssistantCount=assistantCount;
    if(!activeTurn) return;

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

    const completionEvidence=responseActionCount()>activeTurn.responseActionBaseline;
    const readyForNextTurn=composerReady();
    if(completionEvidence && !isGenerating && readyForNextTurn) {
      if(!activeTurn.completionCandidateSince) activeTurn.completionCandidateSince=now;
      if(now-activeTurn.completionCandidateSince>=DONE_QUIET_MS) {
        sendTurn('DONE','completed-response-actions-stable');
        activeTurn=null;
        return;
      }
    } else {
      activeTurn.completionCandidateSince=0;
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
