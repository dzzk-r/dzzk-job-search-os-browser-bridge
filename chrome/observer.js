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
let timelineScope='all';
let currentConversationBinding=null;
let knownConversationBindings=[];
let timelineScopeOptionsFingerprint='';
const expandedKeys=new Set();

function eventKey(event) { const c=event.correlation||{}; return [event.ts||0,event.source||'',event.message||'',c.correlation_id||'',c.span_id||''].join('|'); }

function scopeOptionModel(bindings) {
  const byId=new Map();
  for(const binding of bindings||[]) {
    if(binding?.conversation_id && !byId.has(binding.conversation_id)) byId.set(binding.conversation_id,binding);
  }
  const model=[
    {value:'all',label:'All activity'},
    {value:'unscoped',label:'Unscoped'}
  ];
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
  const open=openSpans(state).filter(s=>{
    if(s.status!=='WAITING') return true;
    const age=now-(s.updated||s.started||now);
    return !(s.actor==='TERM' && age>30);
  });
  const terminal=all.filter(s=>['DONE','ERROR','CANCELED','EXITED'].includes(s.status)).slice(-5);
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
async function refreshPreparedDispatch() {
  const box=$('prepared-dispatch');
  const button=$('dispatch-prepared');
  const label=$('prepared-dispatch-label');
  const status=$('prepared-dispatch-status');
  try {
    const s=await send({type:'dispatch-state'});
    if(!s?.ready) { box.hidden=true; status.textContent=''; button.disabled=false; updateRunDetailGroups(); return; }
    box.hidden=false;
    label.textContent=(s.label||s.task_id||'Prepared task')+(s.goal?' — '+s.goal:'');
    label.title=label.textContent;
    button.title='Start this prepared task as a Harness-owned run.';
    status.textContent='READY';
    button.disabled=false;
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
  const workSources=new Set(['MCP','TERM','ACTION','OC','QWEN','LLAMA']);
  const events=(state.timeline||[]).filter(event=>
    workSources.has(String(event.source||'')) &&
    Number.isFinite(Number(event.ts)) &&
    now-Number(event.ts)<=windowSeconds
  );
  const scoped=events.filter(event=>Boolean(event.correlation?.conversation_id)).length;
  return {total:events.length,scoped,unscoped:events.length-scoped,rate:events.length?Math.round(scoped*100/events.length):null,windowSeconds};
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
  const healthy=health.rate>=90;
  button.classList.add(healthy?'healthy':'degraded');
  if(healthy) {
    label.textContent='Attribution coverage · healthy · '+health.rate+'% · '+health.scoped+'/'+health.total;
    button.title='Recent 2-minute work attribution: '+health.scoped+' scoped, '+health.unscoped+' unscoped.';
  } else {
    button.disabled=false;
    button.setAttribute('aria-disabled','false');
    label.textContent='Attribution coverage · degraded · '+health.unscoped+'/'+health.total+' unscoped · Inspect';
    button.title='Recent 2-minute work attribution is degraded. Click to inspect causal diagnostics.';
    setDisclosureDefault($('trace-section'),true);
  }
  return health;
}

function updateRunDetailGroups() {
  const execution=$('run-execution-group');
  const handoff=$('run-handoff-group');
  if(execution) execution.hidden=$('detached-run-section')?.hidden!==false;
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
    preview.textContent='Last prepared handoff'+(prepared.task_id?' · '+prepared.task_id:'');
    preview.title=preview.textContent;
    meta.title='Elapsed runtime reported for the latest prepared handoff.';
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
  const rows=[
    ['Result',p.result||p.run_status||p.status||'?','', 'Final result reported for this prepared handoff/run.'],
    ['Task',p.task_id||'-','', 'Harness task identifier associated with this prepared handoff.'],
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
    ['Overall',String(p.average_percent??0)+'% average across '+String(p.task_count??0)+' tracked tasks'],
    ['Completed',String(p.complete_count??0)+' / '+String(p.task_count??0)],
    ['Critical path',critical],
    ['Next milestone',milestone?(milestone.id+' · '+milestone.title):'all configured milestones ready'],
    ['Remaining ETA',hoursRange(p.remaining_eta_low_hours,p.remaining_eta_high_hours)+' backlog sum; not calendar time'],
    ['Observed today',seconds(p.observed_today_active_seconds||0)+' active heuristic · '+seconds(p.observed_today_window_seconds||0)+' first→last event window']
  ];
  appendKeyValues($('project-status-summary'),rows);
  $('project-status-meta').textContent=String(p.average_percent??0)+'% · '+String(p.complete_count??0)+'/'+String(p.task_count??0)+' done';
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
    ['Task',task.task_id||'-','', 'Stable Harness task identifier used to correlate lifecycle state and evidence.'],
    ['Status',task.status||'-','', 'High-level task lifecycle status, for example WAITING, RUNNING, DONE or ERROR.'],
    ['Phase',task.phase||'-','', 'Current orchestration phase inside the task lifecycle, such as VERIFYING.'],
    ['Goal',task.goal||'-','', 'Requested outcome the task is expected to produce.'],
    ['Waiting',task.waiting_reason||'-','', 'Why the task cannot advance right now, if it is waiting.'],
    ['Checkpoint',task.last_durable_checkpoint||'-','', 'Latest durable progress marker that can survive interruption or resume.']
  ]);
  appendKeyValues($('task-lifecycle-work'),[
    ['Completed',(task.completed||[]).join(' · ')||'none','', 'Lifecycle steps already completed for this task.'],
    ['Current',task.current||'none','', 'The work step the Harness currently considers in progress.'],
    ['Pending',(task.pending||[]).join(' · ')||'none','', 'Known lifecycle steps still required before the task can finish.'],
    ['Budget',JSON.stringify(task.budget||{}),'', 'Execution limits allocated to this task, such as deadline, agent steps, output tokens and repairs.'],
    ['Budget used',JSON.stringify(task.budget_used||{}),'', 'Observed consumption of the allocated task budget. Empty means no usage metrics were reported.']
  ]);
}

function renderRunInspection(state) {
  const run=state.run_inspection;
  if(!run) {
    appendKeyValues($('run-summary'),[['Status','No local-agent run observed']]);
    $('run-task').textContent='';
    $('run-artifacts').replaceChildren();
    return;
  }
  appendKeyValues($('run-summary'),[
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
  ]);
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
  $('active-chain').textContent=activeChain(state);
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
    const status=document.createElement('span'); status.className='span-status'; status.textContent=span.status||'?';
    const actor=document.createElement('span'); actor.textContent=(span.actor||'?')+(span.pid?' #'+span.pid:'');
    const main=document.createElement('div'); main.className='span-main';
    const label=document.createElement('div'); label.className='span-label'; label.textContent=compactMessage(span.label||span.id||'operation');
    const updateAge=span.ended ? Math.max(0,Math.floor(Date.now()/1000-(span.updated||span.ended))) : Math.max(0,Math.floor(Date.now()/1000-(span.updated||span.started||Date.now()/1000)));
    const meta=document.createElement('div'); meta.className='span-meta';
    meta.textContent='elapsed '+seconds(span.age_seconds||0)+' · last update '+seconds(updateAge)+' ago · '+(span.detail||'');
    main.append(label,meta);
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
    rows.push(['Last RDC',String(rdc.last_summary||rdc.last_tool)]);
    rows.push(['Age',seconds(rdc.last_activity_seconds??0)+' ago']);
  }
  for(const proc of (rdc.open_processes||[])) {
    rows.push(['PID '+String(proc.pid||'?')+' '+String(proc.status||'?'),compactMessage(proc.label||'process')]);
  }
  if(!rows.length) {
    $('rdc-section').hidden=true; box.replaceChildren(); meta.textContent=''; return;
  }
  const frag=document.createDocumentFragment();
  for(const [name,value] of rows) {
    const row=document.createElement('div'); row.className='artifact-row';
    const strong=document.createElement('strong'); strong.textContent=name+': ';
    const span=document.createElement('span'); span.textContent=value;
    row.append(strong,span); frag.append(row);
  }
  box.replaceChildren(frag);
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
  const corr=chooseTraceCorrelation(state);
  const external=currentExternalActivity(state);
  const box=$('trace'), meta=$('trace-meta');
  const title=$('trace-title');
  if(external) {
    title.textContent='Attribution diagnostics';
  } else {
    title.textContent='Attribution / causal trace';
  }
  if(!corr) {
    box.replaceChildren();
    meta.textContent=external?'awaiting authoritative gateway':'no correlated trace';
    $('trace-section').hidden=!external;
    return;
  }
  const events=(state.timeline||[]).filter(e=>e.correlation?.correlation_id===corr);
  const parents=new Map();
  for(const event of events) {
    const c=event.correlation||{};
    if(c.span_id && c.parent_span_id) parents.set(c.span_id,c.parent_span_id);
  }
  const frag=document.createDocumentFragment();
  for(const event of events.slice(-40)) {
    const c=event.correlation||{};
    const row=document.createElement('div'); row.className='trace-row';
    const depth=traceDepth(c.span_id,parents); row.style.setProperty('--depth',String(depth));
    const actor=document.createElement('span'); actor.className='trace-actor'; actor.textContent=event.source||'?';
    const branch=document.createElement('span'); branch.className='trace-branch'; branch.textContent=depth?'↳':'•';
    const msg=document.createElement('span'); msg.className='trace-msg'; msg.textContent=compactMessage(event.message||'');
    row.title=[
      'correlation='+corr,
      c.run_id?'run='+c.run_id:null,
      c.task_id?'task='+c.task_id:null,
      c.span_id?'span='+c.span_id:null,
      c.parent_span_id?'parent='+c.parent_span_id:null,
      'source_quality='+(c.source_quality||'unknown')
    ].filter(Boolean).join('\n');
    row.append(branch,actor,msg); frag.append(row);
  }
  box.replaceChildren(frag);
  const sourceQuality=events.map(e=>e.correlation?.source_quality).find(Boolean)||'unknown';
  meta.textContent=(external?'Recent correlated trace ':'')+'['+correlationShort(corr)+'] · '+events.length+' events · '+sourceQuality;
  meta.title=corr;
  $('trace-section').hidden=false;
}

function compactPollingEvents(events) {
  // Raw timeline must stay literal until semantic grouping can explain itself.
  // Opaque ×N compaction made operator state harder, not easier, to understand.
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
  return [...events];
}
function renderTimeline(state) {
  const box=$('timeline');
  const allEvents=state.timeline||[];
  const events=timelineEventsForScope(allEvents,timelineScope,currentConversationBinding);
  const compacted=compactPollingEvents(events);
  const keys=events.map(eventKey);
  const unchanged=Array.isArray(renderedKeys) && keys.length===renderedKeys.length && keys.every((key,i)=>key===renderedKeys[i]);
  if(!unchanged) {
    for(const row of box.querySelectorAll('.event.expanded')) expandedKeys.add(row.dataset.key);
    const nearTop=box.scrollTop<24;
    const displayEvents=[...compacted].reverse();
    const displayKeys=[...keys].reverse();
    const frag=document.createDocumentFragment();
    for(let i=0;i<displayEvents.length;i++) {
      const event=displayEvents[i], key=displayKeys[i]||eventKey(event);
      const row=document.createElement('div'); row.className='event'; row.dataset.key=key; row.tabIndex=0;
      if(expandedKeys.has(key)) row.classList.add('expanded');
      const time=document.createElement('span'); time.textContent=new Date((event.ts||0)*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
      const src=document.createElement('span'); src.className='src'; src.textContent=event.source;
      const c=event.correlation||{};
      const prefix=c.correlation_id?'['+correlationShort(c.correlation_id)+'] '+(c.parent_span_id?'↳ ':''):'';
      const msg=document.createElement('span'); msg.className='msg'; msg.textContent=prefix+compactMessage(event.message||''); msg.title=event.message||'';
      const full=document.createElement('div'); full.className='event-full';
      const provenance=[
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
        'source_quality='+(c.source_quality||'unknown')
      ].filter(Boolean);
      full.textContent=provenance.join('\n');
      if(c.conversation_id) {
        const nav=document.createElement('button');
        nav.className='source-chat-button';
        nav.textContent='Open source chat';
        nav.title='Activate the ChatGPT conversation that owns this event';
        nav.addEventListener('click',async e=>{
          e.stopPropagation();
          nav.disabled=true;
          try { await send({type:'conversation-open',conversation_id:c.conversation_id}); }
          catch(err) { $('error').textContent=String(err?.message||err); nav.disabled=false; }
        });
        full.append(document.createElement('br'),nav);
      }
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
  $('position').textContent='LIVE '+events.length+'/'+allEvents.length;
}
async function refresh() {
  let currentConversationState=null;
  try {
    currentConversationState=await send({type:'conversation-current'});
    browserLocalChatActivity=currentConversationState?.activity||null;
  } catch {
    browserLocalChatActivity=null;
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
      const selector=$('timeline-scope');
      if(selector) {
        const previous=timelineScope;
        const selectedId=previous.startsWith('chat:') ? previous.slice(5) : null;
        const {model,byId}=scopeOptionModel(knownConversationBindings);
        reconcileTimelineScopeOptions(selector,model);
        const wanted=selectedId && byId.has(selectedId) ? previous : (['all','unscoped'].includes(previous)?previous:'all');
        if(selector.value!==wanted) selector.value=wanted;
        timelineScope=wanted;
        currentConversationBinding=timelineScope.startsWith('chat:') ? byId.get(timelineScope.slice(5))||null : null;
      }
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
    renderRunMeta(state);
    renderTaskLifecycle(state);
    renderProjectStatus(state);
    renderSpans(state);
    renderRdc(state);
    renderTrace(state);
    renderTimeline(state);
    await refreshConnectionRequests();
    await refreshPreparedDispatch();
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
must('timeline').addEventListener('scroll',()=>{
  const box=must('timeline');
  follow=box.scrollTop<24;
});
must('timeline-scope').addEventListener('change',event=>{
  timelineScope=event.target.value;
  currentConversationBinding=timelineScope.startsWith('chat:')
    ? knownConversationBindings.find(x=>x.conversation_id===timelineScope.slice(5))||null
    : null;
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
must('dispatch-prepared').addEventListener('click',async()=>{
  const button=$('dispatch-prepared');
  const status=$('prepared-dispatch-status');
  button.disabled=true; status.textContent='Dispatching…';
  try {
    const result=await send({type:'dispatch-prepared'});
    status.textContent='DISPATCHED'+(result?.pid?' · pid '+result.pid:'');
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
