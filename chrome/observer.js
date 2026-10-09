const panelRuntimeVersion=chrome.runtime.getManifest().version;
const panelDocumentVersion=document.documentElement.dataset.buildVersion||null;
if(panelDocumentVersion && panelDocumentVersion!==panelRuntimeVersion) {
  const target=chrome.runtime.getURL('observer.html')+'?v='+encodeURIComponent(panelRuntimeVersion);
  if(location.href!==target) location.replace(target);
}

const $=id=>document.getElementById(id);
const must=id=>{const element=$(id);if(!element) throw new Error('Missing required Observer element #'+id);return element;};
const send=m=>chrome.runtime.sendMessage(m);
let follow=true;
let renderedKeys=null;
let lastState=null;
let browserLocalChatActivity=null;
let currentBrowserConversationId=null;
let pendingActionApprovalCount=0;
let timelineScope='all';
let timelineView='raw';
let transientTimelineScope=null;
let projectTaskSnapshot=null;
let latestRdcIntent=null;
let currentConversationBinding=null;
let knownConversationBindings=[];
let timelineScopeOptionsFingerprint='';
const expandedKeys=new Set();
const rawRevealKeys=new Set();

function eventKey(event) { const c=event.correlation||{}; return [event.ts||0,event.source||'',event.message||'',c.correlation_id||'',c.span_id||'',c.conversation_id||'',c.turn_id||'',c.source_quality||'',event.attribution||''].join('|'); }

function scopeOptionModel(bindings) {
  const byId=new Map();
  for(const binding of bindings||[]) {
    if(binding?.conversation_id && !byId.has(binding.conversation_id)) byId.set(binding.conversation_id,binding);
  }
  const model=[
    {value:'all',label:'All activity'},
    {value:'unscoped',label:'Unscoped'}
  ];
  if(transientTimelineScope && !model.some(item=>item.value===transientTimelineScope.value)) model.push(transientTimelineScope);
  for(const [id,binding] of byId) {
    const title=String(binding.title||'').trim().replace(/\s+/g,' ');
    model.push({
      value:'chat:'+id,
      label:(binding.is_current?'Current · ':'')+(title||'ChatGPT chat')+' · '+String(id).slice(-8),
      binding
    });
  }
  return {model,byId};
}

function reconcileTimelineScopeOptions(selector, model) {
  const fingerprint=JSON.stringify(model.map(x=>[x.value,x.label]));
  if(fingerprint===timelineScopeOptionsFingerprint) return false;
  const existing=new Map([...selector.options].map(option=>[option.value,option]));
  const ordered=[];
  for(const item of model) {
    let option=existing.get(item.value);
    if(!option) {
      option=document.createElement('option');
      option.value=item.value;
    }
    if(option.textContent!==item.label) option.textContent=item.label;
    ordered.push(option);
    existing.delete(item.value);
  }
  for(const option of existing.values()) option.remove();
  for(let index=0;index<ordered.length;index++) {
    const option=ordered[index];
    if(selector.options[index]!==option) selector.insertBefore(option,selector.options[index]||null);
  }
  timelineScopeOptionsFingerprint=fingerprint;
  return true;
}

function renderTimelineScopeOptions() {
  const selector=$('timeline-scope');
  if(!selector) return;
  const previous=timelineScope;
  const {model,byId}=scopeOptionModel(knownConversationBindings);
  reconcileTimelineScopeOptions(selector,model);
  const valid=new Set(model.map(item=>item.value));
  const wanted=valid.has(previous)?previous:'all';
  selector.value=wanted;
  timelineScope=wanted;
  currentConversationBinding=timelineScope.startsWith('chat:') ? byId.get(timelineScope.slice(5))||null : null;
}

function compactMessage(message) {
  return String(message||'')
    .replaceAll('/Users/dzzk/WORK/_bridge-local-execution/','…/harness/')
    .replaceAll('/Users/dzzk/WORK/browser-bridge-runs/','…/runs/')
    .replaceAll('/Users/dzzk/','~/');
}
function seconds(n) {
  n=Math.max(0,Number(n)||0);
  if(n<60) return String(Math.floor(n))+'s';
  const m=Math.floor(n/60), s=Math.floor(n%60);
  if(m<60) return m+':'+String(s).padStart(2,'0');
  const h=Math.floor(m/60);
  return h+':'+String(m%60).padStart(2,'0')+':'+String(s).padStart(2,'0');
}
function openSpans(state) {
  return (state.spans||[]).filter(s=>!['DONE','ERROR','CANCELED','EXITED'].includes(s.status));
}
function activeSpans(state) {
  return (state.spans||[]).filter(s=>s.status==='RUNNING');
}
function recentSpans(state) {
  const all=state.spans||[];
  const now=Date.now()/1000;
  const currentTask=state.task_lifecycle?.task_id||null;
  const currentRun=state.task_lifecycle?.run_id||null;
  const currentChat=currentBrowserConversationId||null;
  const open=openSpans(state).filter(s=>{
    if(s.status!=='WAITING') return true;
    const age=now-(s.updated||s.started||now);
    return !(s.actor==='TERM' && age>30);
  });
  const terminal=all.filter(s=>{
    if(!['DONE','ERROR','CANCELED','EXITED'].includes(String(s.status||'').toUpperCase())) return false;
    const c=s.correlation||{};
    if(currentTask && c.task_id===currentTask) return true;
    if(currentRun && c.run_id===currentRun) return true;
    if(currentChat && c.conversation_id===currentChat) return true;
    const age=now-Number(s.updated||s.ended||s.started||0);
    return Number.isFinite(age) && age>=0 && age<=180;
  }).slice(-8);
  const seen=new Set();
  return [...open,...terminal].filter(s=>!seen.has(s.id)&&seen.add(s.id)).sort((a,b)=>(b.started||0)-(a.started||0));
}
function detachedRunHealth(state) {
  const run=state.detached_run;
  if(!run) return null;
  const heartbeat=Date.parse(run.heartbeat_at||run.started_at||'')/1000;
  const age=Number.isFinite(heartbeat)?Math.max(0,Date.now()/1000-heartbeat):null;
  return {...run,heartbeat_age_seconds:age};
}
function derivedStatus(state) {
  const detached=detachedRunHealth(state);
  const detachedStatus=String(detached?.status||'').toUpperCase();
  if(['STARTING','RUNNING'].includes(detachedStatus)) {
    if(detached.heartbeat_age_seconds!=null && detached.heartbeat_age_seconds>8) return {label:'STALLED',cls:'stalled',age:detached.heartbeat_age_seconds};
    return {label:'BUSY',cls:'busy',age:detached.heartbeat_age_seconds};
  }
  const task=state.task_lifecycle||{};
  const taskStatus=String(task.status||'').toUpperCase();
  if(taskStatus==='RUNNING') {
    const waiting=Boolean(task.waiting_reason)||String(task.phase||'').toUpperCase().includes('WAIT');
    return {label:waiting?'WAITING':'BUSY',cls:waiting?'waiting':'busy',age:null};
  }
  if(taskStatus==='WAITING') return {label:'WAITING',cls:'waiting',age:null};
  const active=activeSpans(state);
  const stalled=String(state.state||'').startsWith('STALLED');
  if(stalled) return {label:'STALLED',cls:'stalled',age:null};
  if(active.length) {
    const running=active[0];
    return {label:'BUSY',cls:'busy',age:running.age_seconds||0};
  }
  const external=currentExternalActivity(state);
  const externalAge=external?.ts ? Math.max(0,Date.now()/1000-Number(external.ts)) : null;
  if(external && externalAge!=null && externalAge<=10) return {label:'OBSERVED',cls:'observed',age:externalAge};
  if(state.rdc?.last_activity_seconds!=null && state.rdc.last_activity_seconds<=10) return {label:'OBSERVED',cls:'observed',age:state.rdc.last_activity_seconds};
  return {label:'IDLE',cls:'idle',age:null};
}
function activeChain(state) {
  const detached=detachedRunHealth(state);
  if(detached && ['STARTING','RUNNING'].includes(String(detached.status||'').toUpperCase())) {
    return 'HARNESS '+String(detached.phase||detached.status||'RUNNING')+' · detached';
  }
  const active=activeSpans(state);
  if(active.length) {
    return active.slice(-3).map(s=>(s.actor||'?')+(s.pid?' #'+s.pid:'')).join(' › ');
  }
  if(state.active_source) return state.active_source;
  const external=currentExternalActivity(state);
  const externalAge=external?.ts ? Math.max(0,Date.now()/1000-Number(external.ts)) : null;
  if(external && externalAge!=null && externalAge<=10) return 'external MCP/RDC activity · unscoped';
  const open=state.rdc?.open_count||0;
  return open ? (open+' background open · gateway not authoritative') : 'safe locally · gateway not authoritative';
}

function renderActors(state,companionAvailable=true) {
  const activity=state.actor_activity||{};
  const chatActivity=browserLocalChatActivity||state.chat_activity||null;
  const rdcAge=state.rdc?.last_activity_seconds;
  const rdcRecent=Number.isFinite(rdcAge) && rdcAge<=30;
  const defs=[
    ['CHAT',chatActivity?.state==='waiting_user'?'waiting':chatActivity?.state==='pending'?'pending':chatActivity?.state==='active'?'active':'','ChatGPT browser turn','browser conversation / turn context',chatActivity?.state?('state '+chatActivity.state):null],
    ['MCP','','Observed MCP transport activity','transport boundary; only instrumented providers are visible',null],
    ['RDC',rdcRecent?seconds(rdcAge):'','Remote Desktop Commander','provider / tool family',Number.isFinite(rdcAge)?('last observed '+seconds(rdcAge)+' ago'):null],
    ['TERM',(state.rdc?.open_count||0)?String(state.rdc.open_count)+' open':'','Terminal / managed process lifecycle','local process runtime',null],
    ['OC','','OpenCode worker','local executor',null],
    ['QWEN','','Qwen model actor','local model',null],
    ['LLAMA',String(state.llama||'').replace(/^slot\d+:/,''),'llama.cpp inference runtime','local inference runtime',null],
    ['GIT','Δ'+String(state.git_total??0),'Git repository working-tree state','repository state',null]
  ];
  const frag=document.createDocumentFragment();
  for(const [name,detail,fullName,origin,diagnostic] of defs) {
    const isBrowserActor=name==='CHAT';
    const unavailable=!isBrowserActor && !companionAvailable;
    const isActive=isBrowserActor ? chatActivity?.state==='active' : activity[name]===true;
    const isWaiting=isBrowserActor && chatActivity?.state==='waiting_user';
    const isPending=isBrowserActor && chatActivity?.state==='pending';
    const chip=document.createElement('span');
    chip.className='actor-chip '+name.toLowerCase()+(isActive?' active':'')+(isWaiting?' waiting':'')+(isPending?' pending':'')+(unavailable?' unavailable':'');
    const titleParts=[];
    if(origin) titleParts.push(origin);
    if(detail) titleParts.push(detail);
    if(diagnostic) titleParts.push(diagnostic);
    if(unavailable) titleParts.push('telemetry unavailable');
    else if(isActive) titleParts.push(name==='CHAT'?'positive browser activity evidence':'recently observed activity');
    else if(isWaiting) titleParts.push('turn open · waiting for user input');
    else if(isPending) titleParts.push('turn open · no positive activity evidence');
    else titleParts.push('known idle');
    chip.title=titleParts.join(' · ');
    const dot=document.createElement('span'); dot.className='dot';
    const label=document.createElement('span'); label.textContent=name;
    chip.append(dot,label);
    if(detail){const d=document.createElement('span');d.className='detail';d.textContent=detail;chip.append(d);}
    frag.append(chip);
  }
  $('actor-strip').replaceChildren(frag);
}
async function currentShareTarget() {
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id) throw new Error('No active browser tab.');
  let url=tab.url, title=tab.title||'';
  if(!url) {
    try {
      const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>({url:location.href,title:document.title})});
      url=result[0]?.result?.url||'';
      title=result[0]?.result?.title||title;
    } catch {}
  }
  let parsed=null;
  try { parsed=new URL(url); } catch {}
  const shareable=Boolean(parsed&&['http:','https:'].includes(parsed.protocol)&&!tab.incognito&&tab.status!=='loading');
  return {tabId:tab.id,url,title,host:parsed?.hostname||'',shareable};
}
function renderShareTarget(target) {
  const box=$('share-target');
  box.replaceChildren();
  const label=document.createElement('strong');
  label.textContent=target.shareable ? 'Current target' : 'Current target unavailable';
  const detail=document.createElement('span');
  detail.textContent=target.shareable ? ((target.title||'(untitled)')+'\\n'+target.host+'\\n'+target.url) : 'Activate a fully loaded HTTP(S) page and reopen or refresh Bridge controls.';
  box.append(label,detail);
  $('share-current').disabled=!target.shareable;
  $('share-current').textContent=target.shareable ? ('Share '+target.host+' for 30 minutes') : 'Share current tab for 30 minutes';
}
function settingsCard(parent,text,buttons) {
  const div=document.createElement('div'); div.className='card';
  const p=document.createElement('p'); p.textContent=text; div.append(p);
  for(const [label,fn] of buttons){const b=document.createElement('button');b.textContent=label;b.addEventListener('click',fn);div.append(b);}
  parent.append(div);
}
async function refreshExecutorPolicy(preparedReady=false) {
  const select=$('executor-policy-select');
  const status=$('executor-policy-status');
  const compare=$('create-compare-plan');
  try {
    const policy=await send({type:'executor-policy'});
    select.value=policy.mode||'AUTO';
    status.textContent=(policy.mode||'AUTO')+' · dispatch policy'+(policy.updated_at?' · updated '+new Date(policy.updated_at).toLocaleString():'');
    compare.hidden=!preparedReady || policy.mode!=='COMPARE';
    compare.disabled=!preparedReady || policy.mode!=='COMPARE';
  } catch(e) {
    status.textContent='executor policy unavailable';
    compare.hidden=true; compare.disabled=true;
  }
}

async function refreshProjectTasks() {
  const select=$('project-task-select');
  const recommendation=$('project-task-recommendation');
  const status=$('project-task-admission-status');
  const takeNext=$('take-next-task');
  const takeSelected=$('take-selected-task');
  const prepare=$('prepare-current-task');
  const release=$('release-current-task');
  try {
    const snapshot=await send({type:'project-tasks'});
    projectTaskSnapshot=snapshot;
    const previous=select.value;
    const frag=document.createDocumentFragment();
    for(const task of snapshot.tasks||[]) {
      const option=document.createElement('option');
      option.value=task.id;
      option.textContent=(task.priority==='next_milestone'?'★ ':'')+task.id+' · '+task.percent+'% · '+task.title;
      frag.append(option);
    }
    select.replaceChildren(frag);
    const ids=new Set((snapshot.tasks||[]).map(x=>x.id));
    const selected=ids.has(previous)?previous:(snapshot.recommended?.id||'');
    select.value=selected;
    select.disabled=!snapshot.tasks?.length || snapshot.current_admission?.status==='ADMITTED';
    takeSelected.disabled=!snapshot.tasks?.length || snapshot.current_admission?.status==='ADMITTED';
    takeNext.disabled=!snapshot.recommended || snapshot.current_admission?.status==='ADMITTED';
    prepare.disabled=!snapshot.envelope?.ready || snapshot.current_admission?.status!=='ADMITTED';
    release.disabled=snapshot.current_admission?.status!=='ADMITTED';
    recommendation.textContent=snapshot.recommended
      ? 'Recommended next: '+snapshot.recommended.id+' · '+snapshot.recommended.percent+'% · '+snapshot.recommended.title+(snapshot.next_milestone?' · gates '+snapshot.next_milestone.id:'')
      : 'No incomplete backlog item is available.';
    if(snapshot.current_admission?.status==='ADMITTED') {
      status.textContent='ADMITTED · '+snapshot.current_admission.backlog_task_id+' → '+snapshot.current_admission.runtime_task_id+' · '+(snapshot.envelope?.ready?'BOUNDED TASK READY':'PLANNING REQUIRED');
    } else if(snapshot.current_admission?.status==='RELEASED') {
      status.textContent='No active admission · last released '+snapshot.current_admission.backlog_task_id;
    } else {
      status.textContent='No backlog item currently admitted into execution.';
    }
  } catch(e) {
    projectTaskSnapshot=null;
    select.replaceChildren(); select.disabled=true;
    takeNext.disabled=true; takeSelected.disabled=true; prepare.disabled=true; release.disabled=true;
    recommendation.textContent='Backlog admission unavailable';
    status.textContent=String(e?.message||e);
  }
}

async function refreshRdcExecution() {
  const section=$('rdc-execution-section');
  try {
    const snapshot=await send({type:'rdc-intents'});
    const intent=snapshot?.latest||null;
    latestRdcIntent=intent;
    if(!intent) { section.hidden=true; updateRunDetailGroups(); return; }
    section.hidden=false;
    const caps=intent.capabilities||{};
    const approval=intent.approval||{};
    const result=intent.result||{};
    appendKeyValues($('rdc-execution-summary'),[
      ['Intent',intent.intent_id||'-','', 'Stable EDH dispatch intent for this RDC execution attempt.'],
      ['Run',intent.run_id||'-','', 'RDC Run identity allocated before external execution begins.'],
      ['Task',intent.task_id||'-','', 'Bounded Task that this RDC Run is allowed to execute.'],
      ['Status',intent.status||'-','', 'RDC adapter lifecycle: AWAITING_CLAIM, CLAIMED, RUNNING or terminal.'],
      ['Approval',approval.state||'-','', 'External ChatGPT/RDC platform approval boundary. EDH records it but cannot bypass it.'],
      ['Device',intent.adapter?.device_id||'-','', 'RDC device chosen by the external adapter when known.'],
      ['Allowed tools',(caps.rdc_tools||[]).join(', ')||'-','', 'Capability-minimized RDC tool set derived from the bounded Task scope.'],
      ['Declared reads',(caps.declared_reads||[]).join(', ')||'-','', 'Task-declared read scope. Platform RDC permission may be broader, but adapter policy must remain within this scope.'],
      ['Declared writes',(caps.declared_writes||[]).join(', ')||'-','', 'Task-declared write scope.'],
      ['Tool calls',String(intent.metrics?.tool_calls??0),'', 'RDC tool calls recorded under this EDH intent.'],
      ['Tool errors',String(intent.metrics?.tool_errors??0),'', 'Recorded RDC tool errors under this intent.'],
      ['Outcome',result.outcome||'-','', 'Terminal executor result reported back to EDH.']
    ]);
    updateRunDetailGroups();
  } catch(e) {
    latestRdcIntent=null; section.hidden=true; updateRunDetailGroups();
  }
}

async function refreshPreparedDispatch() {
  const box=$('prepared-dispatch');
  const button=$('dispatch-prepared');
  const label=$('prepared-dispatch-label');
  const status=$('prepared-dispatch-status');
  try {
    const s=await send({type:'dispatch-state'});
    if(!s?.ready) { box.hidden=true; status.textContent=''; button.disabled=false; await refreshExecutorPolicy(false); updateRunDetailGroups(); return; }
    box.hidden=false;
    const preparedAt=s.prepared_at?Date.parse(s.prepared_at)/1000:null;
    const preparedAge=Number.isFinite(preparedAt)?seconds(Math.max(0,Date.now()/1000-preparedAt))+' old':'age unknown';
    label.textContent=(s.label||s.task_id||'Ready handoff')+(s.goal?' — '+s.goal:'')+' · prepared '+preparedAge;
    label.title=label.textContent;
    button.title='Dispatch is available only while the handoff state is READY. It starts a new Harness-owned run; completed/PASS handoffs cannot be dispatched again.';
    status.textContent='READY · not yet dispatched';
    button.disabled=false;
    await refreshExecutorPolicy(true);
    updateRunDetailGroups();
  } catch(e) {
    box.hidden=true;
    updateRunDetailGroups();
  }
}

async function refreshConnectionRequests() {
  const box=$('connection-requests');
  try {
    const s=await send({type:'state'});
    box.replaceChildren();
    const requests=s.consents||[];
    pendingActionApprovalCount=(s.actions||[]).length;
    box.hidden=requests.length===0;
    for(const c of requests) {
      const card=document.createElement('div'); card.className='card connection-request-card';
      const title=document.createElement('strong'); title.textContent='Connection request: '+(c.name||'MCP client');
      const detail=document.createElement('p');
      detail.textContent='Callback: '+(c.redirectOrigin||'?')+'. Read explicitly shared Chrome pages only.';
      const allow=document.createElement('button'); allow.className='primary'; allow.textContent='Allow';
      const deny=document.createElement('button'); deny.textContent='Deny';
      const decide=async allowValue=>{
        allow.disabled=true; deny.disabled=true;
        try {
          await send({type:'consent',id:c.id,allow:allowValue});
          await refreshConnectionRequests();
    if(lastState) renderTimeline(lastState);
        } catch(e) {
          allow.disabled=false; deny.disabled=false;
          $('error').textContent=e.message;
        }
      };
      allow.addEventListener('click',()=>void decide(true));
      deny.addEventListener('click',()=>void decide(false));
      card.append(title,detail,allow,deny); box.append(card);
    }
  } catch(e) {
    box.hidden=true;
  }
}

async function refreshSettings() {
  try {
    const s=await send({type:'state'});
    $('bridge-status').textContent=s.status;
    const target=await currentShareTarget();
    renderShareTarget(target);
    $('share-current').disabled=$('share-current').disabled || s.status!=='Connected' || s.paused;
    $('pause-actions').textContent=s.paused?'Resume actions':'Pause all actions';
    $('pause-actions').dataset.paused=String(s.paused);
    const box=$('shared-pages'); box.replaceChildren();
    for(const g of s.grants) settingsCard(box,(g.title||'Shared page')+'\n'+g.url,[['Stop sharing',async()=>{await send({type:'revoke',handle:g.handle});await refreshSettings();}]]);
    $('settings-error').textContent='';
  } catch(e){$('settings-error').textContent=e.message;}
}

function renderExtensionVersion(state) {
  const loaded=chrome.runtime.getManifest().version;
  const disk=state?.extension_version?.disk||null;
  const label=$('extension-version');
  const gateway=$('gateway-version');
  const button=$('reload-version');
  label.textContent='v'+loaded;
  label.title='Loaded extension version '+loaded+(disk?' · disk '+disk:'');
  const mismatch=Boolean(disk&&disk!==loaded);
  button.hidden=!mismatch;
  button.disabled=false;
  button.textContent=mismatch ? ('Reload '+loaded+' → '+disk) : '';
  button.dataset.targetVersion=mismatch?disk:'';

  const gv=state?.gateway_version||{};
  const runtime=gv.runtime_commit?String(gv.runtime_commit).slice(0,8):'?';
  const head=gv.repo_head?String(gv.repo_head).slice(0,8):'?';
  gateway.className='muted gateway-version'+(gv.restart_required?' restart-required':'');
  gateway.textContent=gv.restart_required
    ? ('Gateway restart '+runtime+' → '+head)
    : ('gw '+runtime+(gv.repo_changed?' · repo '+head:''));
  gateway.title='Gateway runtime '+runtime+' · repo HEAD '+head+
    (gv.started_at?' · started '+gv.started_at:'')+
    (gv.repo_changed?' · repository moved since gateway start':'')+
    (gv.restart_required?' · server code changed; restart required':'');
  const versionLine=$('version-line');
  if(versionLine) versionLine.hidden=!gv.restart_required;
}

function setDisclosureDefault(section, open) {
  if(!section || section.dataset.disclosureInitialized==='true') return;
  section.open=Boolean(open);
  section.dataset.disclosureInitialized='true';
}

function recentAttributionHealth(state, windowSeconds=120) {
  const now=Date.now()/1000;
  const workSources=new Set(['MCP','RDC','TERM','ACTION','OC','QWEN','LLAMA']);
  const events=(state.timeline||[]).filter(event=>
    workSources.has(String(event.source||'')) &&
    Number.isFinite(Number(event.ts)) &&
    now-Number(event.ts)<=windowSeconds
  );
  const scoped=events.filter(event=>Boolean(event.correlation?.conversation_id)).length;
  const issues=events.filter(event=>!event.correlation?.conversation_id);
  return {total:events.length,scoped,unscoped:issues.length,issues,rate:events.length?Math.round(scoped*100/events.length):null,windowSeconds};
}

function renderAttributionHealth(state) {
  const health=recentAttributionHealth(state);
  const button=$('attribution-health');
  const label=$('attribution-health-label');
  button.className='attribution-health';
  button.disabled=true;
  button.setAttribute('aria-disabled','true');
  if(!health.total) {
    label.textContent='Attribution coverage · no recent work';
    button.title='No recent work events require conversation attribution in the current 2-minute window.';
    return health;
  }
  const healthy=health.unscoped===0;
  button.classList.add(healthy?'healthy':'degraded');
  if(healthy) {
    label.textContent='Attribution coverage · healthy · 100% · '+health.scoped+'/'+health.total;
    button.title='Recent 2-minute work attribution: every observed work event is scoped to a conversation.';
  } else {
    button.disabled=false;
    button.setAttribute('aria-disabled','false');
    label.textContent='Attribution coverage · degraded · '+health.unscoped+'/'+health.total+' unscoped · Inspect';
    button.title='Recent work contains events with no trustworthy conversation identity. Click to inspect the attribution breakpoints.';
    if(health.rate<90) setDisclosureDefault($('trace-section'),true);
  }
  return health;
}

function updateRunDetailGroups() {
  const execution=$('run-execution-group');
  const handoff=$('run-handoff-group');
  if(execution) execution.hidden=($('detached-run-section')?.hidden!==false)&&($('rdc-execution-section')?.hidden!==false);
  if(handoff) handoff.hidden=($('prepared-dispatch')?.hidden!==false)&&($('prepared-result-section')?.hidden!==false);
}

function renderRunMeta(state) {
  const section=$('run-section');
  const meta=$('run-meta');
  const stateLabel=$('run-state');
  const preview=$('run-preview');
  const run=detachedRunHealth(state);
  const prepared=state.prepared_dispatch;
  const ready=!$('prepared-dispatch')?.hidden;
  const runStatus=String(run?.status||'').toUpperCase();
  const runActive=Boolean(run && !['DONE','ERROR','CANCELED'].includes(runStatus));

  section.hidden=false;

  if(runActive) {
    stateLabel.textContent=runStatus||'RUNNING';
    meta.textContent=run.phase||'active';
    preview.textContent='Harness-owned execution is active'+(run.safe_to_interrupt?' · interrupt '+run.safe_to_interrupt:'');
    preview.title=preview.textContent;
    meta.title='Current execution phase reported by the Harness-owned run.';
    setDisclosureDefault(section,true);
    return;
  }

  const rdcStatus=String(latestRdcIntent?.status||'').toUpperCase();
  if(latestRdcIntent && !['DONE','ERROR','CANCELED','DENIED'].includes(rdcStatus)) {
    stateLabel.textContent=rdcStatus||'RDC';
    meta.textContent='RDC · '+String(latestRdcIntent.approval?.state||'approval unknown');
    preview.textContent='EDH-controlled RDC execution intent'+(latestRdcIntent.task_id?' · '+latestRdcIntent.task_id:'');
    preview.title=preview.textContent;
    meta.title='RDC backend status from the EDH dispatch intent. Platform approval remains external.';
    setDisclosureDefault(section,true);
    return;
  }

  if(ready) {
    stateLabel.textContent='ACTION REQUIRED';
    meta.textContent='Dispatch available';
    preview.textContent='Prepared Harness task is ready to start';
    preview.title=preview.textContent;
    meta.title='A prepared task can be dispatched into Harness-owned execution.';
    setDisclosureDefault(section,true);
    return;
  }

  if(prepared) {
    const result=String(prepared.result||prepared.run_status||prepared.status||'?').toUpperCase();
    stateLabel.textContent=result;
    meta.textContent=prepared.seconds!=null?seconds(prepared.seconds):'last result';
    preview.textContent='Last dispatched handoff / run result'+(prepared.task_id?' · '+prepared.task_id:'');
    preview.title=preview.textContent;
    meta.title='Historical result of the last dispatched handoff. A PASS result is terminal evidence and is not dispatchable again.';
    setDisclosureDefault(section,false);
    return;
  }

  if(run) {
    stateLabel.textContent=runStatus||'DONE';
    meta.textContent=run.phase||'finished';
    preview.textContent='Last Harness-owned run'+(run.ended_at?' · finished':'');
    preview.title=preview.textContent;
    meta.title='Terminal phase of the latest Harness-owned execution.';
    setDisclosureDefault(section,false);
    return;
  }

  stateLabel.textContent='IDLE';
  meta.textContent='';
  preview.textContent='No active or recent run';
  preview.title=preview.textContent;
  meta.title='';
  setDisclosureDefault(section,false);
}

function usageMetricText(metric,{unit='tokens',digits=0}={}) {
  if(!metric || metric.value==null) return 'not reported';
  const value=Number(metric.value);
  const formatted=Number.isFinite(value) ? value.toLocaleString(undefined,{maximumFractionDigits:digits,minimumFractionDigits:digits}) : String(metric.value);
  const quality=metric.quality||'unknown';
  const source=metric.source||'unknown';
  const estimator=metric.estimator?' · '+metric.estimator:'';
  return formatted+(unit?' '+unit:'')+' · '+quality+' · '+source+estimator;
}
function usageCostText(cost) {
  if(!cost) return 'not available';
  if(cost.value_usd!=null) {
    const value=Number(cost.value_usd);
    return '$'+(Number.isFinite(value)?value.toFixed(value<0.01?6:4):String(cost.value_usd))+' · '+(cost.quality||'unknown')+' · '+(cost.source||'unknown');
  }
  if(cost.status==='not_metered') return 'not metered · local runtime';
  return 'not available'+(cost.source?' · '+cost.source:'');
}
function modelUsageRows(usage,profile={}) {
  if(!usage || typeof usage!=='object') return [];
  return [
    ['Provider',usage.provider||profile.provider||'-','', 'Model provider/runtime family associated with this usage record.'],
    ['Model',usage.model||profile.model||'-','', 'Model identity associated with this usage record.'],
    ['Input tokens',usageMetricText(usage.input_tokens),'', 'Exact means provider/runtime reported. Estimated means a local heuristic; estimates are never billing truth.'],
    ['Output tokens',usageMetricText(usage.output_tokens),'', 'Generated token count. Exact/estimated and source are shown explicitly.'],
    ['Total tokens',usageMetricText(usage.total_tokens),'', 'Total normalized token count for this model request.'],
    ['Cache read',usageMetricText(usage.cache_read_tokens),'', 'Prompt/input tokens reported as read from provider/runtime cache, when exposed.'],
    ['Cache write',usageMetricText(usage.cache_write_tokens),'', 'Tokens written/created in provider/runtime cache, when exposed.'],
    ['Throughput',usageMetricText(usage.output_tokens_per_second,{unit:'tok/s',digits:2}),'', 'Output generation throughput. Source states whether the runtime reported it or EDH derived it from output tokens and elapsed time.'],
    ['Cost',usageCostText(usage.cost),'', 'API/provider billing cost only when reported or backed by pricing metadata. Local runtime is marked not metered rather than $0.'],
    ['Usage truth',usage.semantics||'Exact/provider reported where available; local estimates are labeled.','','Accounting provenance rule for this usage record.']
  ];
}

function usageMetricParts(metric,{unit='tokens',digits=0}={}) {
  if(!metric || metric.value==null) return {value:'not reported',quality:'unavailable',source:'not_reported',estimator:null};
  const n=Number(metric.value);
  const formatted=Number.isFinite(n)?n.toLocaleString(undefined,{maximumFractionDigits:digits,minimumFractionDigits:digits}):String(metric.value);
  return {value:formatted+(unit?' '+unit:''),quality:metric.quality||'unknown',source:metric.source||'unknown',estimator:metric.estimator||null};
}
function usageCostParts(cost) {
  if(!cost) return {value:'not available',quality:'unavailable',source:'not_reported'};
  if(cost.value_usd!=null) {
    const n=Number(cost.value_usd);
    return {value:'$'+(Number.isFinite(n)?n.toFixed(n<0.01?6:4):String(cost.value_usd)),quality:cost.quality||'unknown',source:cost.source||'unknown',estimator:null};
  }
  if(cost.status==='not_metered') return {value:'not metered',quality:'unavailable',source:'local_runtime',estimator:null};
  return {value:'not available',quality:'unavailable',source:cost.source||'pricing_unavailable',estimator:null};
}
function appendUsageMetric(parent,label,parts) {
  const box=document.createElement('div'); box.className='usage-metric';
  const l=document.createElement('span'); l.className='usage-metric-label'; l.textContent=label;
  const v=document.createElement('span'); v.className='usage-metric-value'; v.textContent=parts.value;
  const provenance=document.createElement('div'); provenance.className='usage-metric-provenance';
  for(const [text,cls] of [[parts.quality,parts.quality],[parts.source,'source'],[parts.estimator,'estimator']]) {
    if(!text) continue;
    const badge=document.createElement('span'); badge.className='usage-badge '+(cls||''); badge.textContent=text; provenance.append(badge);
  }
  box.append(l,v,provenance); parent.append(box);
}
function appendUsageCard(parent,title,meta='') {
  const card=document.createElement('section'); card.className='usage-card';
  const head=document.createElement('div'); head.className='usage-card-head';
  const t=document.createElement('span'); t.className='usage-card-title'; t.textContent=title;
  const m=document.createElement('span'); m.className='usage-card-meta'; m.textContent=meta;
  head.append(t,m); card.append(head); parent.append(card); return card;
}
function budgetMetric(value,suffix='') {
  return {value:value==null?'not set':String(value)+suffix,quality:value==null?'unavailable':'declared',source:'task_envelope'};
}
function recentResourceRows(state,usage,profile={}) {
  const rows=[];
  const seen=new Set();
  const add=(role,name,quality)=>{ if(!name) return; const key=role+'|'+name; if(seen.has(key)) return; seen.add(key); rows.push([role,String(name),quality]); };
  add('Model',usage?.model||profile.model,usage?.model?'usage_bound':'profile_declared');
  add('Provider',usage?.provider||profile.provider,usage?.provider?'usage_bound':'profile_declared');
  const run=state.run_inspection||{};
  if(run.opencode_version) add('Agent','OpenCode '+run.opencode_version,'run_reported');
  const now=Date.now()/1000;
  const recent=(state.timeline||[]).filter(event=>Number(event.ts||0)>0 && now-Number(event.ts)<=300);
  const counts=new Map();
  for(const event of recent) {
    const src=String(event.source||'').toUpperCase();
    if(src==='RDC') add('Transport','Remote Desktop Commander','recently_observed');
    if(src==='MCP') add('Protocol','MCP','recently_observed');
    if(src==='LLAMA') add('Runtime','llama.cpp','recently_observed');
    if(src==='OC') add('Agent','OpenCode','recently_observed');
    if(src==='QWEN') add('Model','Qwen','recently_observed');
    let tool=null;
    if(src==='RDC') tool=String(event.message||'').match(/^(start_process|read_process_output|search_files|read_file|write_file|list_directory|find_files|kill_process)/)?.[1]||null;
    if(src==='MCP') tool=String(event.message||'').match(/\btool\s+([A-Za-z0-9_.:-]+)/i)?.[1]||null;
    if(tool) counts.set(tool,(counts.get(tool)||0)+1);
  }
  for(const [tool,count] of [...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5)) add('Tool',tool+(count>1?' ×'+count:''),'recently_observed');
  return rows;
}
function renderUsagePanel(state,usage,budget={},profile={}) {
  const root=$('task-usage');
  const hasBudget=budget && Object.keys(budget).length>0;
  const resources=recentResourceRows(state,usage,profile);
  if(!usage && !hasBudget && !resources.length) { root.hidden=true; root.replaceChildren(); return; }
  root.hidden=false; root.replaceChildren();

  if(hasBudget) {
    const card=appendUsageCard(root,'Budget envelope','declared · task_envelope');
    const grid=document.createElement('div'); grid.className='usage-metrics';
    appendUsageMetric(grid,'Deadline',budgetMetric(budget.deadline_seconds,' s'));
    appendUsageMetric(grid,'Agent steps',budgetMetric(budget.max_agent_steps));
    appendUsageMetric(grid,'Output cap',budgetMetric(budget.max_output_tokens,' tokens'));
    appendUsageMetric(grid,'Repairs',budgetMetric(budget.max_repairs));
    card.append(grid);
  }

  if(usage) {
    const identity=[usage.provider||profile.provider,usage.model||profile.model].filter(Boolean).join(' · ')||'model request';
    const card=appendUsageCard(root,'Model usage',identity);
    const grid=document.createElement('div'); grid.className='usage-metrics';
    appendUsageMetric(grid,'Input',usageMetricParts(usage.input_tokens));
    appendUsageMetric(grid,'Output',usageMetricParts(usage.output_tokens));
    appendUsageMetric(grid,'Cache read',usageMetricParts(usage.cache_read_tokens));
    appendUsageMetric(grid,'Cache write',usageMetricParts(usage.cache_write_tokens));
    appendUsageMetric(grid,'Throughput',usageMetricParts(usage.output_tokens_per_second,{unit:'tok/s',digits:2}));
    appendUsageMetric(grid,'Cost',usageCostParts(usage.cost));
    card.append(grid);
  }

  if(resources.length) {
    const card=appendUsageCard(root,'Resources','role-aware · provenance labeled');
    const list=document.createElement('div'); list.className='resource-list';
    for(const [role,name,quality] of resources) {
      const row=document.createElement('div'); row.className='resource-row';
      const r=document.createElement('span'); r.className='resource-role'; r.textContent=role;
      const n=document.createElement('span'); n.className='resource-name'; n.textContent=name;
      const q=document.createElement('span'); q.className='resource-quality'; q.textContent=quality;
      row.append(r,n,q); list.append(row);
    }
    card.append(list);
  }
}
function currentUsage(state) {
  return browserLocalChatActivity?.last_turn_usage || state.task_lifecycle?.budget_used?.model_usage || state.run_inspection?.usage || null;
}
function compactUsageSummary(usage) {
  if(!usage) return 'not reported for current run';
  const input=usage.input_tokens, output=usage.output_tokens;
  if(!input && !output) return 'record exists · token counts unavailable';
  const bits=[];
  if(input?.value!=null) bits.push(Number(input.value).toLocaleString()+' in');
  if(output?.value!=null) bits.push(Number(output.value).toLocaleString()+' out');
  const qualities=[input?.quality,output?.quality].filter(Boolean);
  const q=qualities.length && qualities.every(x=>x===qualities[0])?qualities[0]:'mixed quality';
  if(q) bits.push(q);
  return bits.join(' · ');
}

function appendKeyValues(parent, rows) {
  const frag=document.createDocumentFragment();
  for(const [key,value,cls,help] of rows) {
    const k=document.createElement('span');
    k.className='key';
    k.textContent=key;
    if(help) {
      k.title=help;
      k.classList.add('has-help');
      k.tabIndex=0;
      k.setAttribute('aria-label',key+': '+help);
    }
    const val=document.createElement('span'); val.className='value'+(cls?' '+cls:''); val.textContent=value??'-';
    frag.append(k,val);
  }
  parent.replaceChildren(frag);
}
function renderPreparedResult(state) {
  const p=state.prepared_dispatch;
  const section=$('prepared-result-section');
  if(!p){section.hidden=true; $('prepared-result-summary').replaceChildren(); $('prepared-result-meta').textContent=''; updateRunDetailGroups(); return;}
  section.hidden=false;
  const corr=p.correlation_id?correlationShort(p.correlation_id):'-';
  const files=Array.isArray(p.changed_files)?p.changed_files:[];
  const preparedTs=p.prepared_at?Date.parse(p.prepared_at)/1000:null;
  const dispatchedTs=p.dispatched_at?Date.parse(p.dispatched_at)/1000:null;
  const endedTs=p.ended_at?Date.parse(p.ended_at)/1000:null;
  const nowTs=Date.now()/1000;
  const rows=[
    ['Result',p.result||p.run_status||p.status||'?','', 'Terminal result of the run created from this handoff. PASS means acceptance succeeded; it is historical evidence, not a task waiting for Dispatch.'],
    ['Handoff state',p.status||'-','', 'READY means Dispatch may start a new run. DISPATCHED means that transition already happened and the same handoff must not be dispatched again.'],
    ['Task',p.task_id||'-','', 'Harness task identifier associated with this prepared handoff.'],
    ['Prepared',p.prepared_at?new Date(p.prepared_at).toLocaleString():'-','', 'When the execution envelope was prepared.'],
    ['Prepared age',Number.isFinite(preparedTs)?seconds(Math.max(0,nowTs-preparedTs)):'-','', 'How long ago this execution envelope was prepared.'],
    ['Dispatched',p.dispatched_at?new Date(p.dispatched_at).toLocaleString():'-','', 'When READY crossed into a Harness-owned Run.'],
    ['Finished',p.ended_at?new Date(p.ended_at).toLocaleString():'-','', 'When the resulting run reached its terminal state.'],
    ['Result age',Number.isFinite(endedTs)?seconds(Math.max(0,nowTs-endedTs)):(Number.isFinite(dispatchedTs)?seconds(Math.max(0,nowTs-dispatchedTs)):'-'),'', 'Age of the terminal run result, or dispatch age when no finish timestamp is available.'],
    ['Correlation',corr,'', 'Short correlation identifier linking this run result to its causal trace and evidence.'],
    ['Runtime',p.seconds!=null?seconds(p.seconds):'-','', 'Elapsed execution time reported for the prepared handoff.'],
    ['Executor',p.opencode_version?'OpenCode '+p.opencode_version:'-','', 'Executor runtime and version that performed the work.'],
    ['Model',p.model||'-','', 'Model/runtime identity used by the executor for this run.'],
    ['Artifacts',files.length?files.join(', '):'-','', 'Files or durable outputs produced or changed by this run.'],
    ['Outcome',p.outcome_reason||p.worker_status||'-','', 'Harness interpretation of why the run ended in its reported result.']
  ];
  appendKeyValues($('prepared-result-summary'),rows);
  $('prepared-result-meta').textContent=(p.result||p.run_status||p.status||'?')+(p.seconds!=null?' · '+seconds(p.seconds):'');
  updateRunDetailGroups();
}
function projectAge(secondsValue) {
  const n=Math.max(0,Number(secondsValue)||0);
  const days=Math.floor(n/86400);
  const hours=Math.floor((n%86400)/3600);
  return days?days+'d '+hours+'h':hours+'h';
}
function appendTrajectoryRows(parent,rows) {
  const frag=document.createDocumentFragment();
  for(const [date,value,detail] of rows) {
    const row=document.createElement('div'); row.className='trajectory-row';
    const d=document.createElement('span'); d.className='trajectory-date'; d.textContent=date;
    const v=document.createElement('span'); v.className='trajectory-value'; v.textContent=value;
    const rest=document.createElement('span'); rest.className='trajectory-detail'; rest.textContent=detail||'';
    row.append(d,v,rest); frag.append(row);
  }
  parent.replaceChildren(frag);
}

function hoursRange(low,high) {
  const lo=Number(low)||0, hi=Number(high)||0;
  if(!hi) return '0 h';
  return (lo===hi?String(lo):String(lo)+'–'+String(hi))+' h';
}
function renderProjectStatus(state) {
  const p=state.project_status;
  const section=$('project-status-section');
  if(!p){section.hidden=true; return;}
  section.hidden=false;
  const critical=(p.critical_path||[]).map(t=>t.id+' '+t.percent+'%').join(' · ')||'-';
  const milestone=p.next_milestone;
  const rows=[
    ['Project',p.project_name||p.project_id||'-','', 'Selected Harness Project whose task graph is being projected here. It is independent of the current ChatGPT conversation.'],
    ['Project ID',p.project_id||'-','', 'Stable project identity used by readiness configuration and future project selection.'],
    ['Task catalog',compactMessage(p.task_catalog_path||'TODO.md'),'','Percentages and task rows are read from this TODO catalog.'],
    ['Milestones',compactMessage(p.readiness_path||'project/readiness.json'),'','Milestone gates and supporting-task relationships are read from this readiness file.'],
    ['Calculation',p.calculation_protocol||'todo-percent-average-v1','','Overall is recomputed from the explicit percentages stored in TODO.md; the Observer does not ask an LLM to estimate these percentages.'],
    ['Catalog updated',p.task_catalog_updated_at?new Date(p.task_catalog_updated_at).toLocaleString():'unknown','','Filesystem modification time of TODO.md. This tells you when the inputs last changed, not when the Observer last refreshed.'],
    ['Refresh','automatic on Observer snapshot','','The Observer rereads the files automatically. The values stay unchanged until TODO.md or readiness configuration changes.'],
    ['Overall',String(p.average_percent??0)+'% average across '+String(p.task_count??0)+' tracked tasks','', 'Arithmetic average of tracked task percentages from TODO.md. Informative only; milestone readiness remains gate-based.'],
    ['Completed',String(p.complete_count??0)+' / '+String(p.task_count??0),'', 'Tracked tasks whose completion value is 100%.'],
    ['Critical path',critical,'', 'Configured unfinished tasks that currently gate the next delivery milestone.'],
    ['Next milestone',milestone?(milestone.id+' · '+milestone.title):'all configured milestones ready','', 'First configured milestone whose supporting tasks are not all complete.'],
    ['Remaining ETA',hoursRange(p.remaining_eta_low_hours,p.remaining_eta_high_hours)+' backlog sum; not calendar time','', 'Sum of remaining task effort estimates. This is backlog effort, not a delivery-date prediction.'],
    ['Observed today',seconds(p.observed_today_active_seconds||0)+' active heuristic · '+seconds(p.observed_today_window_seconds||0)+' first→last event window','', 'Observed event activity today. Active time is a heuristic with event gaps capped; window is first-to-last observed event.']
  ];
  appendKeyValues($('project-status-summary'),rows);
  const projectLabel=p.project_name||p.project_id||'Project identity unavailable';
  $('project-status-project').textContent=projectLabel;
  $('project-status-project').title='Selected Project: '+projectLabel+'. Project scope is independent of the current ChatGPT conversation.';
  $('project-status-meta').textContent=String(p.average_percent??0)+'% · '+String(p.complete_count??0)+'/'+String(p.task_count??0)+' backlog items complete';
  const t=p.trajectory||{};
  appendKeyValues($('project-trajectory-summary'),[
    ['Started',t.started_at?new Date(t.started_at).toLocaleString():'unknown','', 'First commit in the current Git lineage.'],
    ['EDH since',t.edh_since?new Date(t.edh_since).toLocaleString():'unknown','', 'First commit whose package identity is execution-delivery-harness.'],
    ['Project age',t.age_seconds==null?'-':projectAge(t.age_seconds),'', 'Elapsed wall-clock age from the first commit in this lineage.'],
    ['Commits',String(t.commit_count??0),'', 'Git commits reachable from the current branch HEAD.'],
    ['Last 24h',String(t.commits_last_24h??0)+' commits','', 'Commits authored in the rolling 24-hour window.'],
    ['Average velocity',t.average_commits_per_day==null?'-':String(t.average_commits_per_day)+' commits/day','', 'Simple average commit rate over project wall-clock age; this is delivery activity, not story-point throughput.'],
    ['TODO checkpoints',String(t.todo_commit_count??0),'', 'Commits that changed TODO.md, indicating project-model/readiness evolution.']
  ]);
  appendTrajectoryRows($('project-readiness-history'),(t.readiness_trajectory||[]).map(item=>[
    item.date,String(item.average_percent)+'%',String(item.complete_count)+'/'+String(item.task_count)+' complete · '+item.commit
  ]));
  appendTrajectoryRows($('project-version-history'),(t.recent_versions||[]).map(item=>[
    new Date(item.at).toLocaleDateString(),item.version,item.hash+' · '+item.subject
  ]));
}

function renderDetachedRun(state) {
  const section=$('detached-run-section');
  const run=detachedRunHealth(state);
  if(!run) { section.hidden=true; updateRunDetailGroups(); return; }
  section.hidden=false;
  const terminal=['DONE','ERROR','CANCELED'].includes(String(run.status||'').toUpperCase());
  const ended=Date.parse(run.ended_at||'')/1000;
  const finishedAge=Number.isFinite(ended)?Math.max(0,Date.now()/1000-ended):null;
  $('detached-heartbeat').textContent=terminal
    ? (finishedAge==null?'finished':'finished '+seconds(finishedAge)+' ago')
    : (run.heartbeat_age_seconds==null?'heartbeat unknown':'heartbeat '+seconds(run.heartbeat_age_seconds)+' ago');
  appendKeyValues($('detached-run-summary'),[
    ['Controller',run.controller_id||'-','', 'Durable controller identity that owns this Harness execution.'],
    ['Status',run.status||'-','', 'High-level run status, for example RUNNING, WAITING, DONE, ERROR or CANCELED.'],
    ['Phase',run.phase||'-','', 'Current or terminal execution phase inside this run.'],
    ['PID',run.pid==null?'-':String(run.pid),'', 'Local operating-system process ID when this run owns a live process.'],
    ['Ownership',run.owner||'-','', 'Which subsystem currently owns responsibility for progressing this run.'],
    ['Mode',run.mode||'-','', 'Execution mode, for example detached Harness-owned work versus interactive execution.'],
    ['Safe to interrupt',run.safe_to_interrupt||'-','', 'Declared interruption boundary for this run; informational until an explicit stop action is used.'],
    ['Run dir',run.run_dir||'-','', 'Durable filesystem directory containing this run state, checkpoints and evidence.']
  ]);
  updateRunDetailGroups();
}

function renderTaskLifecycle(state) {
  const task=state.task_lifecycle;
  const section=$('task-lifecycle-section');
  section.hidden=false;
  if(!task) {
    $('task-state').textContent='NO DATA';
    $('task-preview').textContent='No lifecycle task received';
    $('task-safety').textContent='interrupt unknown';
    $('task-safety').title='The Harness has not received enough task lifecycle state to judge interruption safety.';
    appendKeyValues($('task-lifecycle-summary'),[
      ['Task','No lifecycle task received'],
      ['Status','NO DATA'],
      ['Phase','-']
    ]);
    $('task-lifecycle-work').replaceChildren();
    $('task-usage').replaceChildren(); $('task-usage').hidden=true;
    $('task-evidence-actions').replaceChildren();
    return;
  }
  const terminal=['DONE','ERROR','CANCELED'].includes(String(task.status||'').toUpperCase());
  setDisclosureDefault(section,!terminal);
  $('task-lifecycle-title').textContent=terminal?'Last task':'Current task';
  $('task-state').textContent=String(task.phase||task.status||'?').toUpperCase();
  const previewParts=[];
  if(task.task_id) previewParts.push(task.task_id);
  if(task.current) previewParts.push(task.current);
  else if(task.goal) previewParts.push(task.goal);
  const previewText=previewParts.join(' · ')||'Task lifecycle details';
  $('task-preview').textContent=previewText;
  $('task-preview').title=previewText;
  const safe=String(task.safe_to_interrupt||'?');
  $('task-safety').textContent=safe==='yes'||safe==='true'||safe==='after_checkpoint' ? 'safe to interrupt' : ('interrupt '+safe);
  $('task-safety').title=safe==='after_checkpoint'
    ? 'Orchestration safety status: stopping after the current durable checkpoint should preserve accepted progress. This badge is informational; use the owning run/control to actually stop work.'
    : 'Orchestration safety status reported by the owning Harness task/run. This badge does not stop anything by itself.';
  appendKeyValues($('task-lifecycle-summary'),[
    ['Task',task.task_id||'-','', 'Stable Harness runtime task identifier used to correlate lifecycle state and evidence.'],
    ['Backlog item',task.source?.backlog_task_id||'-','', 'Project TODO/catalog item that this runtime task was admitted from, when applicable.'],
    ['Status',task.status||'-','', 'High-level task lifecycle status, for example WAITING, RUNNING, DONE or ERROR.'],
    ['Phase',task.phase||'-','', 'Current orchestration phase inside the task lifecycle, such as VERIFYING.'],
    ['Goal',task.goal||'-','', 'Requested outcome the task is expected to produce.'],
    ['Waiting',task.waiting_reason||'-','', 'Why the task cannot advance right now, if it is waiting.'],
    ['Checkpoint',task.last_durable_checkpoint||'-','', 'Latest durable progress marker that can survive interruption or resume.']
  ]);
  const taskActions=$('task-evidence-actions'); taskActions.replaceChildren();
  if(task.task_id) {
    const b=document.createElement('button'); b.type='button'; b.textContent='Show task timeline';
    b.addEventListener('click',()=>focusTimelineScope('task:'+task.task_id,'Task · '+task.task_id)); taskActions.append(b);
  }
  if(task.run_id) {
    const b=document.createElement('button'); b.type='button'; b.textContent='Show run timeline';
    b.addEventListener('click',()=>focusTimelineScope('run:'+task.run_id,'Run · '+task.run_id)); taskActions.append(b);
  }
  const usage=task.budget_used?.model_usage||null;
  appendKeyValues($('task-lifecycle-work'),[
    ['Completed',(task.completed||[]).join(' · ')||'none','', 'Lifecycle steps already completed for this task.'],
    ['Current',task.current||'none','', 'The work step the Harness currently considers in progress.'],
    ['Pending',(task.pending||[]).join(' · ')||'none','', 'Known lifecycle steps still required before the task can finish.']
  ]);
  renderUsagePanel(state,usage,task.budget||{},task.execution_profile||{});
}

function renderRunInspection(state) {
  const run=state.run_inspection;
  if(!run) {
    appendKeyValues($('run-summary'),[['Status','No local-agent run observed']]);
    $('run-task').textContent='';
    $('run-artifacts').replaceChildren();
    return;
  }
  const runRows=[
    ['Run',run.id],
    ['Result',String(run.status||'?').toUpperCase()],
    ['Reason',run.reason||'-','failure-reason'],
    ['Executor','OpenCode '+(run.opencode_version||'-')],
    ['Model',run.model||'-'],
    ['Budget',(run.steps??'?')+' steps · '+(run.tokens_per_turn??'?')+' tokens/turn · '+(run.deadline_seconds??'?')+'s deadline'],
    ['Elapsed',run.elapsed_seconds==null?'-':String(run.elapsed_seconds)+'s'],
    ['Process exit',run.process_exit==null?'-':String(run.process_exit)],
    ['Expected',run.expected||'-'],
    ['Changed',(run.changed_files||[]).join(', ')||'none'],
    ['Run dir',run.run_dir||'-']
  ];
  runRows.push(...modelUsageRows(run.usage, {provider:run.provider,model:run.model}));
  appendKeyValues($('run-summary'),runRows);
  $('run-task').textContent=run.task||'(task text unavailable)';
  const frag=document.createDocumentFragment();
  for(const [name,path] of Object.entries(run.artifacts||{})) {
    const row=document.createElement('div'); row.className='artifact-row';
    const strong=document.createElement('strong'); strong.textContent=name+': ';
    const value=document.createElement('span'); value.textContent=path;
    row.append(strong,value); frag.append(row);
  }
  $('run-artifacts').replaceChildren(frag);
}

function renderHeader(state) {
  const status=derivedStatus(state);
  $('state-label').textContent=status.label;
  $('state-age').textContent=status.age==null?'':seconds(status.age);
  const chain=activeChain(state);
  $('active-chain').textContent=chain;
  $('active-chain').title=chain;
  $('state-dot').className='state-dot '+status.cls;

  const v=state.versions||{};
  const rows=[
    ['Observer',state.state||'?'],
    ['Active actor',state.active_source||'-'],
    ['Run',state.run||'-'],
    ['OpenCode run',state.run_opencode||'-'],
    ['OpenCode default',v.opencode_default||'?'],
    ['OpenCode installed',v.opencode_parallel||'-'],
    ['llama.cpp',v.llama||'?'],
    ['llama slot',state.llama||'?'],
    ['MCP',v.mcp||'?'],
    ['Git',String(state.git_total||0)+' changed/untracked'],
    ['Last activity',seconds(state.last_activity_seconds??0)+' ago'],
    ['Turn truth','MCP gateway not implemented; current ChatGPT dispatch can be invisible']
  ];
  appendKeyValues($('runtime-grid'),rows);
  appendKeyValues($('help-runtime-grid'),rows);
  renderRunInspection(state);
}
function renderSpans(state) {
  const spans=recentSpans(state);
  const openCount=spans.filter(s=>!['DONE','ERROR','CANCELED','EXITED'].includes(s.status)).length;
  const frag=document.createDocumentFragment();
  for(const span of spans) {
    const row=document.createElement('div');
    row.className='span-row '+String(span.status||'').toLowerCase();
    const status=document.createElement('span'); status.className='span-status has-help'; status.textContent=span.status||'?'; status.title='Span lifecycle status: running/open, waiting, done, error, canceled or exited.';
    const actor=document.createElement('span'); actor.className='has-help'; actor.textContent=(span.actor||'?')+(span.pid?' #'+span.pid:''); actor.title='Observed actor/provider that owns this bounded operation. PID is shown when the span maps to a local process.';
    const main=document.createElement('div'); main.className='span-main';
    const label=document.createElement('div'); label.className='span-label has-help'; label.textContent=compactMessage(span.label||span.id||'operation'); label.title='Operation represented by this causally scoped execution span.';
    const updateAge=span.ended ? Math.max(0,Math.floor(Date.now()/1000-(span.updated||span.ended))) : Math.max(0,Math.floor(Date.now()/1000-(span.updated||span.started||Date.now()/1000)));
    const meta=document.createElement('div'); meta.className='span-meta';
    const terminalDetail=String(span.detail||'').trim();
    const statusText=String(span.status||'').trim().toUpperCase();
    const detailText=terminalDetail && terminalDetail.toUpperCase()!==statusText ? ' · '+terminalDetail : '';
    meta.textContent='elapsed '+seconds(span.age_seconds||0)+' · last update '+seconds(updateAge)+' ago'+detailText;
    meta.title='Elapsed is the span duration. Last update is observation freshness. A terminal event identical to the Status column is intentionally not repeated here.';
    main.append(label,meta);
    const actions=document.createElement('div'); actions.className='span-actions';
    const show=document.createElement('button'); show.type='button'; show.textContent='Show in timeline';
    show.addEventListener('click',()=>focusTimelineScope('span:'+span.id,'Span · '+compactMessage(span.label||span.id)));
    actions.append(show); main.append(actions);
    row.append(status,actor,main);
    frag.append(row);
  }
  $('spans').replaceChildren(frag);
  $('span-count').textContent=openCount+' open · '+Math.max(0,spans.length-openCount)+' recent';
  const spansSection=$('spans-section');
  spansSection.hidden=spans.length===0;
  setDisclosureDefault(spansSection,openCount>0||spans.some(s=>String(s.status||'').toUpperCase()==='ERROR'));
}
function renderRdc(state) {
  const rdc=state.rdc||{};
  const box=$('rdc-activity'), meta=$('rdc-meta');
  const rows=[];
  if(rdc.last_tool) {
    rows.push(['Transport','Remote Desktop Commander','', 'Observed transport/provider carrying remote filesystem, search or process-control operations.']);
    rows.push(['Last operation',String(rdc.last_summary||rdc.last_tool),'', 'Most recent RDC operation observed by the Harness.']);
    rows.push(['Last activity',seconds(rdc.last_activity_seconds??0)+' ago','', 'Age of the most recent observed RDC event; this is not the duration of current work.']);
  }
  for(const proc of (rdc.open_processes||[])) {
    rows.push(['Process '+String(proc.pid||'?'),String(proc.status||'?')+' · '+compactMessage(proc.label||'process'),'', 'Background process currently known to the transport. Process presence is durable state; it does not by itself imply current activity.']);
  }
  if(!rows.length) {
    $('rdc-section').hidden=true; box.replaceChildren(); meta.textContent=''; return;
  }
  appendKeyValues(box,rows);
  meta.textContent=(rdc.last_activity_seconds!=null?'RDC '+seconds(rdc.last_activity_seconds)+' ago · ':'')+String(rdc.open_count||0)+' process'+((rdc.open_count||0)===1?'':'es');
  const section=$('rdc-section');
  section.hidden=false;
  setDisclosureDefault(section,false);
}

function correlationShort(value) {
  return String(value||'').replace(/^corr:/,'').split('-')[0]||'?';
}
function latestTimelineEvent(state) {
  const events=state.timeline||[];
  return events.length?events.at(-1):null;
}
function latestCorrelatedEvent(state) {
  const events=state.timeline||[];
  for(let i=events.length-1;i>=0;i--) {
    if(events[i].correlation?.correlation_id) return events[i];
  }
  return null;
}
function currentExternalActivity(state) {
  const latest=latestTimelineEvent(state);
  const correlated=latestCorrelatedEvent(state);
  if(!latest || latest.correlation?.correlation_id) return null;
  if(correlated && Number(latest.ts||0)<=Number(correlated.ts||0)) return null;
  return latest;
}

function chooseTraceCorrelation(state) {
  const events=state.timeline||[];
  const active=(state.spans||[]).filter(s=>s.status==='RUNNING' && s.correlation?.correlation_id);
  if(active.length) return active.at(-1).correlation.correlation_id;
  for(let i=events.length-1;i>=0;i--) {
    const corr=events[i].correlation?.correlation_id;
    if(corr) return corr;
  }
  return null;
}
function traceDepth(spanId,parents) {
  let depth=0, current=spanId, seen=new Set();
  while(current && parents.get(current) && !seen.has(current) && depth<8) {
    seen.add(current); current=parents.get(current); depth++;
  }
  return depth;
}
function renderTrace(state) {
  const health=recentAttributionHealth(state);
  const section=$('trace-section'), box=$('trace'), meta=$('trace-meta'), title=$('trace-title');
  title.textContent='Attribution diagnostics';

  if(!health.total || health.unscoped===0) {
    section.hidden=true;
    box.replaceChildren();
    meta.textContent='';
    section.open=false;
    return;
  }

  section.hidden=false;
  const severe=health.rate<90;
  meta.textContent=health.unscoped+' unscoped · '+health.total+' work events · last '+health.windowSeconds+'s';
  meta.title='Recent attribution coverage: '+health.scoped+' scoped, '+health.unscoped+' unscoped.';

  const frag=document.createDocumentFragment();
  for(const event of health.issues.slice(-12).reverse()) {
    const c=event.correlation||{};
    const row=document.createElement('div'); row.className='trace-row attribution-issue';
    const branch=document.createElement('span'); branch.className='trace-branch'; branch.textContent='!';
    const actor=document.createElement('span'); actor.className='trace-actor'; actor.textContent=event.source||'?';
    const msg=document.createElement('span'); msg.className='trace-msg'; msg.textContent=compactMessage(event.message||'');
    row.title=[
      'problem=missing conversation_id',
      c.correlation_id?'correlation='+c.correlation_id:'correlation=unknown',
      c.turn_id?'turn='+c.turn_id:'turn=unknown',
      c.source_quality?'source_quality='+c.source_quality:'source_quality=unknown'
    ].join('\n');
    row.append(branch,actor,msg); frag.append(row);
  }
  box.replaceChildren(frag);

  if(severe) {
    section.open=true;
    section.dataset.disclosureInitialized='true';
  } else if(section.dataset.disclosureInitialized!=='true') {
    section.open=false;
    section.dataset.disclosureInitialized='true';
  }
}

function compactPollingEvents(events) {
  // Raw timeline stays literal and lossless. Grouped/Semantic are projections only.
  return events.map(event=>({...event,repeat_count:1}));
}
function timelineConversationId(event) {
  const c=event?.correlation||{};
  return c.conversation_id||null;
}
function timelineEventsForScope(events,scope,binding) {
  if(scope==='all') return [...events];
  if(scope==='unscoped') return events.filter(event=>!timelineConversationId(event));
  if(scope.startsWith('chat:')) {
    const id=scope.slice(5);
    return events.filter(event=>timelineConversationId(event)===id);
  }
  if(scope.startsWith('task:')) {
    const id=scope.slice(5);
    return events.filter(event=>(event.correlation||{}).task_id===id);
  }
  if(scope.startsWith('run:')) {
    const id=scope.slice(4);
    return events.filter(event=>(event.correlation||{}).run_id===id);
  }
  if(scope.startsWith('span:')) {
    const id=scope.slice(5);
    return events.filter(event=>{ const c=event.correlation||{}; return c.span_id===id || c.parent_span_id===id; });
  }
  return [...events];
}
function focusTimelineScope(value,label) {
  transientTimelineScope={value,label};
  timelineScope=value;
  timelineScopeOptionsFingerprint='';
  renderedKeys=null;
  if(lastState) {
    renderTimelineScopeOptions();
    $('timeline-scope').value=value;
    renderTimeline(lastState);
  }
  $('timeline-section')?.scrollIntoView({block:'start',behavior:'smooth'});
}
function sourceEventRef(event) {
  return event.event_id||event.id||eventKey(event);
}
function rawEventProvenance(event) {
  const c=event.correlation||{};
  return [
    event.message||'',
    c.correlation_id ? 'correlation='+c.correlation_id : 'correlation=unknown',
    c.run_id ? 'run='+c.run_id : null,
    c.task_id ? 'task='+c.task_id : null,
    c.plan_id ? 'plan='+c.plan_id : null,
    c.span_id ? 'span='+c.span_id : null,
    c.client ? 'client='+c.client : null,
    c.conversation_id ? 'conversation='+c.conversation_id : null,
    c.turn_id ? 'turn='+c.turn_id : null,
    c.message_id ? 'message='+c.message_id : null,
    c.action_id ? 'action='+c.action_id : null,
    c.action_label ? 'action_label='+c.action_label : null,
    event.process_key ? 'process_key='+event.process_key : null,
    event.process_id!=null ? 'pid='+event.process_id : null,
    'source_quality='+(c.source_quality||'unknown')
  ].filter(Boolean);
}
function firstCorrelation(events) {
  for(const event of events) {
    const c=event.correlation||{};
    if(Object.values(c).some(Boolean)) return {...c};
  }
  return {};
}
function messagePhase(event) {
  const text=String(event?.message||'').toUpperCase();
  if(/^ERROR\b/.test(text)||/\bREQUEST_ERROR\b/.test(text)) return 'ERROR';
  if(/^DONE\b/.test(text)||/^TURN_DONE\b/.test(text)||/\bREQUEST_DONE\b/.test(text)) return 'DONE';
  if(/^CANCELED\b/.test(text)||/^CANCELLED\b/.test(text)) return 'CANCELED';
  if(/^EXITED\b/.test(text)) return 'ENDED_UNKNOWN';
  if(/^TURN_ACTIVE\b/.test(text)) return 'ACTIVE';
  if(/^TURN_START\b/.test(text)||/^START\b/.test(text)||/\bREQUEST_START\b/.test(text)) return 'RUNNING';
  return null;
}
function groupedStatus(kind,events) {
  const phases=events.map(messagePhase).filter(Boolean);
  if(kind==='chat') {
    if(phases.includes('DONE')) return 'DONE';
    if(phases.includes('ACTIVE')) return 'ACTIVE';
    return 'RUNNING';
  }
  for(const phase of [...phases].reverse()) {
    if(['ERROR','CANCELED','ENDED_UNKNOWN','DONE'].includes(phase)) return phase;
  }
  return phases.includes('RUNNING')?'RUNNING':'OBSERVED';
}
function humanStatus(status) {
  return ({
    DONE:'done', ERROR:'error', CANCELED:'canceled', ENDED_UNKNOWN:'ended · outcome unknown',
    ACTIVE:'active', RUNNING:'running', OBSERVED:'observed'
  })[status]||String(status||'observed').toLowerCase();
}
function mcpToolName(events) {
  for(const event of events) {
    const c=event.correlation||{};
    if(c.action_label) return String(c.action_label);
    const m=String(event.message||'').match(/\btool\s+([A-Za-z0-9_.:-]+)/i);
    if(m) return m[1];
  }
  return 'tool call';
}
function processPid(events) {
  for(const event of events) if(event.process_id!=null) return event.process_id;
  for(const event of events) {
    const m=String(event.message||'').match(/\bpid=(\d+)/i);
    if(m) return Number(m[1]);
  }
  return null;
}
function makeGroupedItem(kind,key,events,firstIndex) {
  const sorted=[...events].sort((a,b)=>(a.ts||0)-(b.ts||0));
  const status=groupedStatus(kind,sorted);
  const latest=sorted.at(-1)||{};
  const correlation=firstCorrelation(sorted);
  let source=latest.source||'?';
  let message='Observed activity · '+humanStatus(status);
  if(kind==='mcp') {
    source='MCP';
    const tool=mcpToolName(sorted);
    let outcome=humanStatus(status);
    const terminal=String([...sorted].reverse().find(event=>['ERROR','DONE','CANCELED'].includes(messagePhase(event)))?.message||'');
    if(status==='ERROR' && /denied|blocked|paused/i.test(terminal)) outcome='blocked';
    else if(status==='ERROR' && /cancel/i.test(terminal)) outcome='canceled';
    message=tool+' · '+outcome;
  } else if(kind==='chat') {
    source='CHAT';
    message='ChatGPT turn · '+humanStatus(status);
  } else if(kind==='process') {
    source='TERM';
    const pid=processPid(sorted);
    message=(pid!=null?'Process '+pid:'Process execution')+' · '+humanStatus(status);
  }
  return {
    ts:Math.max(...sorted.map(event=>Number(event.ts)||0)),
    source,message,correlation,
    _derived:true,_projection:'grouped',_ruleset:'timeline-grouped-v1',_groupKind:kind,_groupKey:key,
    _status:status,_rawEvents:sorted,_derivedFrom:sorted.map(sourceEventRef),_firstIndex:firstIndex
  };
}
function groupedTimelineEvents(events) {
  const groups=new Map();
  const singles=[];
  events.forEach((event,index)=>{
    const c=event.correlation||{};
    let kind=null,key=null;
    if(event.source==='CHAT' && (c.turn_id||c.run_id||c.span_id)) {
      kind='chat'; key='chat:'+(c.turn_id||c.run_id||c.span_id);
    } else if(event.source==='MCP' && (c.correlation_id||c.span_id)) {
      kind='mcp'; key='mcp:'+(c.correlation_id||c.span_id);
    } else if((event.source==='RDC'||event.source==='TERM') && event.process_key) {
      kind='process'; key='process:'+event.process_key;
    }
    if(!key) {
      singles.push({_firstIndex:index,item:{...event,_derived:false,_projection:'raw'}});
      return;
    }
    if(!groups.has(key)) groups.set(key,{kind,key,events:[],firstIndex:index});
    groups.get(key).events.push(event);
  });
  const projected=[...singles];
  for(const group of groups.values()) projected.push({_firstIndex:group.firstIndex,item:makeGroupedItem(group.kind,group.key,group.events,group.firstIndex)});
  projected.sort((a,b)=>a._firstIndex-b._firstIndex);
  return projected.map(entry=>entry.item);
}
function processCommand(events) {
  for(const event of events) {
    if(event.source!=='RDC') continue;
    const text=String(event.message||'');
    const marker='start_process:';
    const at=text.indexOf(marker);
    if(at>=0) return text.slice(at+marker.length).trim();
  }
  return '';
}
function semanticCommandLabel(command) {
  const c=String(command||'');
  if(/\bnpm\s+test\b|\bnode\s+--test\b/.test(c)) return 'Run automated tests';
  if(/\bgit\s+(diff|status|log|show)\b/.test(c) && !/\bgit\s+(add|commit|push)\b/.test(c)) return 'Inspect repository state';
  if(/\bgit\s+commit\b/.test(c) && /\bgit\s+push\b/.test(c)) return 'Checkpoint and publish changes';
  if(/\bgit\s+(add|commit|push)\b/.test(c)) return 'Update Git checkpoint';
  if(/python3?\s+-\s+<<|Path\([^)]*\)\.write_text|\.replace\(/.test(c)) return 'Modify source or test files';
  if(/\b(grep|sed|find|cat)\b/.test(c)) return 'Inspect repository files';
  return 'Run local command';
}
function semanticTimelineEvents(events) {
  return groupedTimelineEvents(events).map(item=>{
    if(!item._derived) {
      return {
        ...item,
        _derived:true,_projection:'semantic',_ruleset:'timeline-semantic-v1',_groupKind:'event',
        _status:messagePhase(item)||'OBSERVED',_rawEvents:[{...item,_derived:undefined,_projection:undefined}],_derivedFrom:[sourceEventRef(item)],
        message:compactMessage(item.message||'')
      };
    }
    let source=item.source, message=item.message;
    if(item._groupKind==='process') {
      source='EXEC';
      message=semanticCommandLabel(processCommand(item._rawEvents))+' · '+humanStatus(item._status);
    } else if(item._groupKind==='mcp') {
      message='Tool '+mcpToolName(item._rawEvents)+' · '+humanStatus(item._status);
      const terminal=String([...item._rawEvents].reverse().find(event=>messagePhase(event)==='ERROR')?.message||'');
      if(item._status==='ERROR' && /denied|blocked|paused/i.test(terminal)) message='Tool '+mcpToolName(item._rawEvents)+' · blocked';
      else if(item._status==='ERROR' && /cancel/i.test(terminal)) message='Tool '+mcpToolName(item._rawEvents)+' · canceled';
    } else if(item._groupKind==='chat') {
      message='ChatGPT turn · '+humanStatus(item._status);
    }
    return {...item,source,message,_projection:'semantic',_ruleset:'timeline-semantic-v1'};
  });
}
function projectTimeline(events,view) {
  const raw=compactPollingEvents(events);
  if(view==='grouped') return groupedTimelineEvents(raw);
  if(view==='semantic') return semanticTimelineEvents(raw);
  return raw.map(event=>({...event,_derived:false,_projection:'raw'}));
}
function projectedEventKey(event) {
  if(!event._derived) return 'raw|'+eventKey(event);
  return [event._projection,event._ruleset,event._groupKey||event._groupKind||'',...(event._derivedFrom||[])].join('|');
}
function appendSourceChatButton(full,conversationId) {
  if(!conversationId) return;
  const nav=document.createElement('button');
  nav.className='source-chat-button';
  nav.textContent='Open source chat';
  nav.title='Activate the ChatGPT conversation that owns this event';
  nav.addEventListener('click',async e=>{
    e.stopPropagation();
    nav.disabled=true;
    const idleLabel='Open source chat';
    try {
      const result=await send({type:'conversation-open',conversation_id:conversationId});
      $('error').textContent='';
      nav.textContent=result?.opened==='current'?'Source chat is current':'Opened source chat';
      nav.title=result?.opened==='current'?'This event belongs to the ChatGPT conversation already active in this window.':'The ChatGPT conversation that owns this event was activated.';
      setTimeout(()=>{ nav.textContent=idleLabel; nav.title='Activate the ChatGPT conversation that owns this event'; nav.disabled=false; },1600);
    } catch(err) {
      $('error').textContent=String(err?.message||err);
      nav.textContent='Open failed · retry';
      nav.title='Source chat could not be opened. Click to retry.';
      nav.disabled=false;
    }
  });
  full.append(document.createElement('br'),nav);
}
function appendRawEventDrilldown(full,event,key) {
  const rawEvents=event._rawEvents||[];
  if(!event._derived || !rawEvents.length) return;
  const button=document.createElement('button');
  button.className='source-chat-button raw-events-button';
  const rawBox=document.createElement('div');
  rawBox.className='raw-event-list';
  const revealed=rawRevealKeys.has(key);
  rawBox.hidden=!revealed;
  const label=()=>((rawBox.hidden?'Show ':'Hide ')+rawEvents.length+' raw event'+(rawEvents.length===1?'':'s'));
  button.textContent=label();
  button.title='Reveal the exact source ledger events used to derive this row';
  for(const raw of rawEvents) {
    const item=document.createElement('div'); item.className='raw-event-item';
    const head=document.createElement('div'); head.className='raw-event-head';
    head.textContent=new Date((raw.ts||0)*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})+'  '+String(raw.source||'?')+'  '+String(raw.message||'');
    const detail=document.createElement('pre'); detail.textContent=rawEventProvenance(raw).slice(1).join('\n');
    item.append(head,detail); rawBox.append(item);
  }
  button.addEventListener('click',e=>{
    e.stopPropagation();
    rawBox.hidden=!rawBox.hidden;
    if(rawBox.hidden) rawRevealKeys.delete(key); else rawRevealKeys.add(key);
    button.textContent=label();
  });
  full.append(document.createElement('br'),button,rawBox);
}
const QUIESCENCE_QUIET_SECONDS=15;
function quiescenceOutstandingSpans(state) {
  const now=Date.now()/1000;
  return (state.spans||[]).filter(span=>{
    const status=String(span.status||'').toUpperCase();
    if(['DONE','ERROR','CANCELED','EXITED'].includes(status)) return false;
    if(status==='WAITING' && span.actor==='TERM') {
      const updated=Number(span.updated||span.started||0);
      return updated>0 && now-updated<=30;
    }
    return true;
  });
}
function quiescenceRelevantEvents(state) {
  const workSources=new Set(['MCP','RDC','TERM','OC','QWEN','LLAMA','ACTION','CHAT']);
  const currentId=currentBrowserConversationId;
  const events=state.timeline||[];
  return events.filter(event=>{
    if(!workSources.has(String(event.source||'').toUpperCase())) return false;
    const conversation=timelineConversationId(event);
    if(currentId && conversation===currentId) return true;
    // Until gateway attribution is authoritative, recent unscoped execution must
    // conservatively delay a "safe next request" claim.
    return !conversation && String(event.source||'').toUpperCase()!=='CHAT';
  });
}
function deriveQuiescence(state) {
  const now=Date.now()/1000;
  const chat=browserLocalChatActivity||state.chat_activity||{state:'idle'};
  const chatState=String(chat.state||'idle');
  const spans=quiescenceOutstandingSpans(state);
  const events=quiescenceRelevantEvents(state);
  const latest=events.length?events.reduce((a,b)=>Number(a.ts||0)>=Number(b.ts||0)?a:b):null;
  const latestTs=latest?.ts?Number(latest.ts):null;
  const latestAge=latestTs ? Math.max(0,now-latestTs) : null;
  const latestLabel=latest ? String(latest.source||'?')+' · '+compactMessage(latest.message||'') : 'none observed';
  if(chatState==='active' || spans.some(span=>String(span.status||'').toUpperCase()==='RUNNING')) {
    return {state:'WORKING',safe:false,quality:'observer_inferred',reason:chatState==='active'?'ChatGPT turn has positive activity evidence':spans.length+' execution span(s) are running',latestAge,latestLabel,latestTs};
  }
  if(chatState==='waiting_user' || pendingActionApprovalCount>0) {
    return {state:'SETTLING',safe:false,quality:'observer_inferred',reason:pendingActionApprovalCount>0?pendingActionApprovalCount+' browser action approval(s) are pending':'ChatGPT turn is waiting for user input/approval',latestAge,latestLabel,latestTs};
  }
  if(chatState==='pending') {
    return {state:'SETTLING',safe:false,quality:'observer_inferred',reason:'ChatGPT turn is still open without positive activity evidence',latestAge,latestLabel,latestTs};
  }
  if(spans.length) {
    return {state:'SETTLING',safe:false,quality:'observer_inferred',reason:spans.length+' non-terminal execution span(s) remain observable',latestAge,latestLabel,latestTs};
  }
  if(latestAge!==null && latestAge<QUIESCENCE_QUIET_SECONDS) {
    const remaining=Math.max(1,Math.ceil(QUIESCENCE_QUIET_SECONDS-latestAge));
    return {state:'SETTLING',safe:false,quality:'observer_inferred',reason:'quiet-window probation · '+remaining+'s remaining after latest relevant evidence',latestAge,latestLabel,latestTs};
  }
  return {
    state:'QUIESCENT',safe:true,quality:'observer_inferred',
    reason:latestAge===null?'no outstanding observed execution and no recent relevant evidence':'no outstanding observed execution · quiet for '+Math.floor(latestAge)+'s',
    latestAge,latestLabel,latestTs
  };
}
function renderTimelineLive(state,rawCount,totalCount,displayCount) {
  const live=activeSpans(state).length>0 || browserLocalChatActivity?.state==='active';
  const cluster=$('position');
  cluster.classList.toggle('active',live);
  const total=Number.isFinite(totalCount)?totalCount:rawCount;
  const viewName=timelineView[0].toUpperCase()+timelineView.slice(1);
  $('timeline-live-trigger').title=live?'Live timeline · observed work is active':'Live timeline · no positive activity evidence right now';
  const q=deriveQuiescence(state);
  cluster.classList.remove('working','settling','quiescent');
  cluster.classList.add(q.state.toLowerCase());
  const badge=$('timeline-quiescence');
  badge.textContent=q.state;
  badge.className='timeline-quiescence '+q.state.toLowerCase();
  badge.removeAttribute('title');
  badge.setAttribute('aria-label',q.state==='QUIESCENT'
    ? 'Observed quiescence: no known outstanding work; observer-inferred until GW-01 owns dispatch.'
    : q.state+'; current idle gap is not a proven end-of-turn boundary.');

  $('timeline-activity-summary').textContent=live?'ACTIVE':'IDLE';
  $('timeline-quiescence-summary').textContent=q.state;
  $('timeline-last-evidence').textContent=q.latestTs
    ? new Date(q.latestTs*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})+' · '+seconds(q.latestAge)+' ago'
    : 'none observed';
  $('timeline-window-summary').textContent=rawCount.toLocaleString()+' / '+total.toLocaleString()+' raw events';
  $('timeline-view-summary').textContent=viewName+' · '+displayCount.toLocaleString()+' row'+(displayCount===1?'':'s');
  $('timeline-usage-summary').textContent=compactUsageSummary(currentUsage(state));
  $('timeline-live-updated').textContent='updated '+new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
  $('timeline-quiescence-reason').textContent=q.reason+'. Latest: '+q.latestLabel+'.';
}

function renderTimeline(state) {
  const box=$('timeline');
  const allEvents=state.timeline||[];
  const scoped=state.timeline_scopes?.[timelineScope];
  const events=Array.isArray(scoped)?scoped:timelineEventsForScope(allEvents,timelineScope,currentConversationBinding);
  const projected=projectTimeline(events,timelineView);
  const keys=projected.map(projectedEventKey);
  const unchanged=Array.isArray(renderedKeys) && keys.length===renderedKeys.length && keys.every((key,i)=>key===renderedKeys[i]);
  if(!unchanged) {
    for(const row of box.querySelectorAll('.event.expanded')) expandedKeys.add(row.dataset.key);
    const nearTop=box.scrollTop<24;
    const displayEvents=[...projected].reverse();
    const displayKeys=[...keys].reverse();
    const frag=document.createDocumentFragment();
    for(let i=0;i<displayEvents.length;i++) {
      const event=displayEvents[i], key=displayKeys[i]||projectedEventKey(event);
      const row=document.createElement('div'); row.className='event'+(event._derived?' derived-event':''); row.dataset.key=key; row.tabIndex=0;
      if(expandedKeys.has(key)) row.classList.add('expanded');
      const time=document.createElement('span'); time.textContent=new Date((event.ts||0)*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
      const src=document.createElement('span'); src.className='src'; src.textContent=event.source;
      const c=event.correlation||{};
      const prefix=!event._derived && c.correlation_id?'['+correlationShort(c.correlation_id)+'] '+(c.parent_span_id?'↳ ':''):'';
      const msg=document.createElement('span'); msg.className='msg'; msg.textContent=prefix+compactMessage(event.message||''); msg.title=event.message||'';
      const full=document.createElement('div'); full.className='event-full';
      if(event._derived) {
        const metadata=[
          'projection='+event._ruleset,
          'derived_from='+(event._derivedFrom||[]).length+' raw event'+((event._derivedFrom||[]).length===1?'':'s'),
          event._status?'status='+event._status:null,
          c.correlation_id?'correlation='+c.correlation_id:'correlation=unknown',
          c.conversation_id?'conversation='+c.conversation_id:null,
          c.turn_id?'turn='+c.turn_id:null,
          'source_quality='+(c.source_quality||'unknown')
        ].filter(Boolean);
        full.textContent=metadata.join('\n');
        appendRawEventDrilldown(full,event,key);
      } else {
        full.textContent=rawEventProvenance(event).join('\n');
      }
      appendSourceChatButton(full,c.conversation_id);
      const toggle=()=>{ row.classList.toggle('expanded'); if(row.classList.contains('expanded')) expandedKeys.add(key); else expandedKeys.delete(key); };
      row.addEventListener('click',toggle);
      row.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggle(); }});
      row.append(time,src,msg,full); frag.append(row);
    }
    box.replaceChildren(frag);
    renderedKeys=keys;
    if(follow || nearTop) { box.scrollTop=0; follow=true; }
  }
  const current=currentConversationBinding?.conversation_id;
  $('current-conversation').textContent=current ? 'chat '+String(current).slice(-8) : (timelineScope==='unscoped'?'without chat identity':'');
  const scopeTotal=Number(state.timeline_scope_totals?.[timelineScope]);
  renderTimelineLive(state,events.length,Number.isFinite(scopeTotal)?scopeTotal:allEvents.length,projected.length);
}

async function refresh() {
  let currentConversationState=null;
  try {
    currentConversationState=await send({type:'conversation-current'});
    browserLocalChatActivity=currentConversationState?.activity||null;
    currentBrowserConversationId=currentConversationState?.binding?.conversation_id||null;
  } catch {
    browserLocalChatActivity=null;
    currentBrowserConversationId=null;
  }
  try {
    const state=await send({type:'observer-state'});
    state.chat_local_activity=browserLocalChatActivity;
    try {
      const conversationState=await send({type:'conversation-state'});
      const activeBinding=currentConversationState?.binding ? {...currentConversationState.binding,is_current:true} : null;
      const cachedBindings=conversationState?.bindings||[];
      const ledgerBindings=[];
      for(const event of (state.timeline||[])) {
        const id=timelineConversationId(event);
        if(!id) continue;
        const c=event.correlation||{};
        ledgerBindings.push({
          conversation_id:id,
          title:event.meta?.title||'',
          url:c.locator||event.meta?.url||'',
          source_quality:c.source_quality||'unknown',
          observedAt:event.ts||0
        });
      }
      const byMergedId=new Map();
      for(const binding of [...cachedBindings,...ledgerBindings,...(activeBinding?[activeBinding]:[])]) {
        if(!binding?.conversation_id) continue;
        const prior=byMergedId.get(binding.conversation_id)||{};
        byMergedId.set(binding.conversation_id,{...prior,...binding});
      }
      knownConversationBindings=[...byMergedId.values()];
      renderTimelineScopeOptions();
    } catch {
      knownConversationBindings=[];
      currentConversationBinding=null;
    }
    $('error').textContent='';
    lastState=state;
    renderActors(state,true);
    renderHeader(state);
    renderExtensionVersion(state);
    renderAttributionHealth(state);
    renderPreparedResult(state);
    renderDetachedRun(state);
    await refreshRdcExecution();
    await refreshPreparedDispatch();
    renderRunMeta(state);
    renderTaskLifecycle(state);
    renderProjectStatus(state);
    await refreshProjectTasks();
    renderSpans(state);
    renderRdc(state);
    renderTrace(state);
    renderTimeline(state);
    await refreshConnectionRequests();
  } catch(e) {
    const message=String(e?.message||e);
    const degraded=message.includes('observer_unavailable')||message.includes('Observer snapshot is unavailable');
    $('error').textContent=message;
    $('state-label').textContent=degraded?'DEGRADED':'OFFLINE';
    $('state-dot').className='state-dot error';
    $('active-chain').textContent=degraded?'Observer snapshot unavailable':'Companion unavailable';
    renderActors(lastState?{...lastState,chat_local_activity:browserLocalChatActivity}:{chat_local_activity:browserLocalChatActivity},false);
  }
}
must('reload-version').addEventListener('click',async()=>{
  const button=must('reload-version');
  button.disabled=true;
  try { await send({type:'reload-extension'}); }
  catch { /* runtime reload can invalidate the message channel after acceptance */ }
});
must('take-next-task').addEventListener('click',async()=>{
  const status=$('project-task-admission-status');
  const button=$('take-next-task');
  button.disabled=true; status.textContent='Taking recommended backlog item…';
  try {
    const admission=await send({type:'task-admission',action:'take_next'});
    status.textContent='ADMITTED · '+admission.backlog_task_id+' · creating Current task';
    await refresh();
  } catch(e) { status.textContent=String(e?.message||e); await refreshProjectTasks(); }
});

must('take-selected-task').addEventListener('click',async()=>{
  const id=$('project-task-select').value;
  const status=$('project-task-admission-status');
  if(!id) return;
  const button=$('take-selected-task');
  button.disabled=true; status.textContent='Taking '+id+'…';
  try {
    const admission=await send({type:'task-admission',action:'take',task_id:id});
    status.textContent='ADMITTED · '+admission.backlog_task_id+' · creating Current task';
    await refresh();
  } catch(e) { status.textContent=String(e?.message||e); await refreshProjectTasks(); }
});

must('prepare-current-task').addEventListener('click',async()=>{
  const status=$('project-task-admission-status');
  const button=$('prepare-current-task');
  button.disabled=true; status.textContent='Preparing bounded handoff…';
  try {
    const result=await send({type:'task-admission',action:'prepare'});
    status.textContent='READY FOR HANDOFF · '+(result.prepared?.task_id||'bounded task');
    await refresh();
  } catch(e) { status.textContent=String(e?.message||e); await refreshProjectTasks(); }
});

must('release-current-task').addEventListener('click',async()=>{
  const status=$('project-task-admission-status');
  const button=$('release-current-task');
  button.disabled=true; status.textContent='Releasing current admission…';
  try {
    const admission=await send({type:'task-admission',action:'release'});
    status.textContent='RELEASED · '+admission.backlog_task_id;
    await refresh();
  } catch(e) { status.textContent=String(e?.message||e); await refreshProjectTasks(); }
});

must('timeline').addEventListener('scroll',()=>{
  const box=must('timeline');
  follow=box.scrollTop<24;
});
must('timeline-scope').addEventListener('change',event=>{
  timelineScope=event.target.value;
  if(!transientTimelineScope || timelineScope!==transientTimelineScope.value) transientTimelineScope=null;
  currentConversationBinding=timelineScope.startsWith('chat:')
    ? knownConversationBindings.find(x=>x.conversation_id===timelineScope.slice(5))||null
    : null;
  renderedKeys=null;
  if(lastState) renderTimeline(lastState);
});
must('timeline-view').addEventListener('click',event=>{
  const button=event.target.closest('button[data-view]');
  if(!button) return;
  const next=button.dataset.view;
  if(!['raw','grouped','semantic'].includes(next) || next===timelineView) return;
  timelineView=next;
  for(const candidate of must('timeline-view').querySelectorAll('button[data-view]')) candidate.setAttribute('aria-pressed',String(candidate===button));
  renderedKeys=null;
  if(lastState) renderTimeline(lastState);
});
void refresh();
setInterval(()=>void refresh(),1500);

must('help-toggle').addEventListener('click',()=>{$('help-panel').hidden=false;if(lastState){renderRunInspection(lastState);renderHeader(lastState);}});
must('help-close').addEventListener('click',()=>{$('help-panel').hidden=true;});
must('settings-toggle').addEventListener('click',async()=>{$('settings-panel').hidden=false;await refreshSettings();});
must('settings-close').addEventListener('click',()=>{$('settings-panel').hidden=true;});
must('share-current').addEventListener('click',async()=>{
  try{
    const target=await currentShareTarget();
    if(!target.shareable) throw new Error('Current tab is not a fully loaded HTTP(S) page.');
    await send({type:'share',tabId:target.tabId});
    await refreshSettings();
  }catch(e){$('settings-error').textContent=e.message;}
});
must('pause-actions').addEventListener('click',async()=>{
  try{await send({type:'set-policy',paused:$('pause-actions').dataset.paused!=='true'});await refreshSettings();}
  catch(e){$('settings-error').textContent=e.message;}
});
must('open-options').addEventListener('click',()=>chrome.runtime.openOptionsPage());


must('attribution-health').addEventListener('click',()=>{
  const section=$('trace-section');
  if(section) { section.hidden=false; section.open=true; section.scrollIntoView({block:'nearest'}); }
});
must('gw01-acceptance').addEventListener('click',async()=>{
  const button=$('gw01-acceptance');
  const status=$('gw01-acceptance-status');
  button.disabled=true; status.textContent='Running…';
  try {
    const result=await send({type:'gw01-acceptance'});
    const corr=String(result?.correlation_id||'').replace(/^corr:/,'').slice(0,8);
    status.textContent=(result?.result||'DONE')+' · action→MCP '+String(result?.action_before_mcp_ms??'?')+' ms · ['+corr+']';
    await refresh();
  } catch(e) {
    status.textContent=String(e?.message||e);
  } finally {
    button.disabled=false;
  }
});
must('executor-policy-select').addEventListener('change',async event=>{
  const select=event.currentTarget;
  const status=$('executor-policy-status');
  select.disabled=true; status.textContent='Saving executor policy…';
  try {
    const policy=await send({type:'set-executor-policy',mode:select.value});
    status.textContent=policy.mode+' · dispatch policy · updated '+new Date(policy.updated_at).toLocaleString();
    const prepared=await send({type:'dispatch-state'}).catch(()=>null);
    await refreshExecutorPolicy(Boolean(prepared?.ready));
  } catch(e) { status.textContent=String(e?.message||e); }
  finally { select.disabled=false; }
});

must('create-compare-plan').addEventListener('click',async()=>{
  const button=$('create-compare-plan');
  const status=$('executor-policy-status');
  button.disabled=true; status.textContent='Creating sibling EDH/RDC run plan…';
  try {
    const plan=await send({type:'create-compare-plan'});
    status.textContent='COMPARE PLANNED · '+plan.comparison_id+' · same task/baseline, 2 sibling runs';
  } catch(e) { status.textContent=String(e?.message||e); }
  finally { button.disabled=false; }
});

must('dispatch-prepared').addEventListener('click',async()=>{
  const button=$('dispatch-prepared');
  const status=$('prepared-dispatch-status');
  button.disabled=true; status.textContent='Dispatching…';
  try {
    const result=await send({type:'dispatch-prepared'});
    if(result?.status==='AWAITING_RDC') {
      status.textContent='AWAITING RDC · '+(result.intent?.intent_id||'external handoff recorded');
    } else if(result?.status==='COMPARE_PLANNED') {
      status.textContent='COMPARE PLANNED · '+(result.comparison_id||'2 sibling runs');
    } else {
      status.textContent=(result?.status||'DISPATCHED')+(result?.executor_policy?' · '+result.executor_policy:'')+(result?.pid?' · pid '+result.pid:'');
    }
    await refreshPreparedDispatch();
    await refresh();
  } catch(e) {
    const message=String(e?.message||e);
    status.textContent=message;
    button.disabled=false;
    if(/no prepared Harness task is ready/i.test(message)) {
      const box=$('prepared-dispatch');
      box.hidden=true;
      status.textContent='';
      button.disabled=false;
      if(lastState) renderRunMeta(lastState);
    }
  }
});
