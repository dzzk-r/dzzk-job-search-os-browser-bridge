const $=id=>document.getElementById(id);
const send=m=>chrome.runtime.sendMessage(m);
let follow=true;
let renderedKeys=[];
let lastState=null;
const expandedKeys=new Set();

function eventKey(event) { return String(event.ts||0)+'|'+String(event.source||'')+'|'+String(event.message||''); }
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
function recentSpans(state) {
  const all=state.spans||[], open=openSpans(state);
  const terminal=all.filter(s=>['DONE','ERROR','CANCELED','EXITED'].includes(s.status)).slice(-5);
  const seen=new Set();
  return [...open,...terminal].filter(s=>!seen.has(s.id)&&seen.add(s.id)).sort((a,b)=>(b.started||0)-(a.started||0));
}
function derivedStatus(state) {
  const open=openSpans(state);
  const stalled=String(state.state||'').startsWith('STALLED');
  if(stalled) return {label:'STALLED',cls:'stalled',age:state.last_activity_seconds??0};
  if(open.length) {
    const running=open.find(s=>s.status==='RUNNING')||open[0];
    const cls=running.status==='WAITING'?'waiting':'busy';
    return {label:running.status==='WAITING'?'WAITING':'BUSY',cls,age:running.age_seconds||0};
  }
  if(state.state==='FAILED') return {label:'ERROR',cls:'error',age:state.last_activity_seconds??0};
  return {label:'IDLE',cls:'idle',age:state.last_activity_seconds??0};
}
function activeChain(state) {
  const open=openSpans(state);
  if(open.length) {
    return open.slice(-3).map(s=>(s.actor||'?')+(s.pid?' #'+s.pid:'')).join(' › ');
  }
  if(state.active_source) return state.active_source;
  return 'safe locally · gateway not authoritative';
}

function renderActors(state) {
  const activity=state.actor_activity||{};
  const defs=[
    ['MCP',''],
    ['TERM',''],
    ['OC',''],
    ['QWEN',''],
    ['LLAMA',String(state.llama||'').replace(/^slot\d+:/,'')],
    ['GIT','Δ'+String(state.git_total??0)]
  ];
  const frag=document.createDocumentFragment();
  for(const [name,detail] of defs) {
    const isActive=activity[name]===true;
    const chip=document.createElement('span');
    chip.className='actor-chip '+name.toLowerCase()+(isActive?' active':'');
    chip.title=isActive ? name+' has confirmed current activity' : name+' is known but idle';
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

function appendKeyValues(parent, rows) {
  const frag=document.createDocumentFragment();
  for(const [key,value,cls] of rows) {
    const k=document.createElement('span'); k.className='key'; k.textContent=key;
    const val=document.createElement('span'); val.className='value'+(cls?' '+cls:''); val.textContent=value??'-';
    frag.append(k,val);
  }
  parent.replaceChildren(frag);
}
function renderTaskLifecycle(state) {
  const task=state.task_lifecycle;
  const section=$('task-lifecycle-section');
  if(!task) { section.hidden=true; return; }
  section.hidden=false;
  $('task-safety').textContent='safe to interrupt: '+String(task.safe_to_interrupt||'?');
  appendKeyValues($('task-lifecycle-summary'),[
    ['Task',task.task_id||'-'],
    ['Status',task.status||'-'],
    ['Phase',task.phase||'-'],
    ['Goal',task.goal||'-'],
    ['Waiting',task.waiting_reason||'-'],
    ['Checkpoint',task.last_durable_checkpoint||'-']
  ]);
  const frag=document.createDocumentFragment();
  const rows=[
    ['Completed',(task.completed||[]).join(' · ')||'none'],
    ['Current',task.current||'none'],
    ['Pending',(task.pending||[]).join(' · ')||'none'],
    ['Budget',JSON.stringify(task.budget||{})],
    ['Budget used',JSON.stringify(task.budget_used||{})]
  ];
  for(const [name,value] of rows){const row=document.createElement('div');row.className='artifact-row';const strong=document.createElement('strong');strong.textContent=name+': ';const span=document.createElement('span');span.textContent=value;row.append(strong,span);frag.append(row);}
  $('task-lifecycle-work').replaceChildren(frag);
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
  $('state-age').textContent=seconds(status.age);
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
  renderRunInspection(state);
}
function renderSpans(state) {
  const spans=recentSpans(state);
  const openCount=openSpans(state).length;
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
  $('spans-section').hidden=spans.length===0;
}
function renderTimeline(state) {
  const box=$('timeline');
  const events=state.timeline||[];
  const keys=events.map(eventKey);
  const unchanged=keys.length===renderedKeys.length && keys.every((key,i)=>key===renderedKeys[i]);
  if(!unchanged) {
    for(const row of box.querySelectorAll('.event.expanded')) expandedKeys.add(row.dataset.key);
    const nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<24;
    const frag=document.createDocumentFragment();
    for(let i=0;i<events.length;i++) {
      const event=events[i], key=keys[i];
      const row=document.createElement('div'); row.className='event'; row.dataset.key=key; row.tabIndex=0;
      if(expandedKeys.has(key)) row.classList.add('expanded');
      const time=document.createElement('span'); time.textContent=new Date((event.ts||0)*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
      const src=document.createElement('span'); src.className='src'; src.textContent=event.source;
      const msg=document.createElement('span'); msg.className='msg'; msg.textContent=compactMessage(event.message||''); msg.title=event.message||'';
      const full=document.createElement('div'); full.className='event-full'; full.textContent=event.message||'';
      const toggle=()=>{ row.classList.toggle('expanded'); if(row.classList.contains('expanded')) expandedKeys.add(key); else expandedKeys.delete(key); };
      row.addEventListener('click',toggle);
      row.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggle(); }});
      row.append(time,src,msg,full); frag.append(row);
    }
    box.replaceChildren(frag);
    renderedKeys=keys;
    if(follow || nearBottom) { box.scrollTop=box.scrollHeight; follow=true; }
  }
  $('position').textContent='LIVE '+events.length;
}
async function refresh() {
  try {
    const state=await send({type:'observer-state'});
    $('error').textContent='';
    lastState=state;
    renderHeader(state);
    renderActors(state);
    renderTaskLifecycle(state);
    renderSpans(state);
    renderTimeline(state);
  } catch(e) {
    $('error').textContent=e.message;
    $('state-label').textContent='OFFLINE';
    $('state-dot').className='state-dot error';
    $('active-chain').textContent='Observer unavailable';
  }
}
$('timeline').addEventListener('scroll',()=>{
  const box=$('timeline');
  follow=box.scrollHeight-box.scrollTop-box.clientHeight<24;
});
void refresh();
setInterval(()=>void refresh(),1500);

$('help-toggle').addEventListener('click',()=>{$('help-panel').hidden=false;if(lastState){renderRunInspection(lastState);renderHeader(lastState);}});
$('help-close').addEventListener('click',()=>{$('help-panel').hidden=true;});
$('settings-toggle').addEventListener('click',async()=>{$('settings-panel').hidden=false;await refreshSettings();});
$('settings-close').addEventListener('click',()=>{$('settings-panel').hidden=true;});
$('share-current').addEventListener('click',async()=>{
  try{
    const target=await currentShareTarget();
    if(!target.shareable) throw new Error('Current tab is not a fully loaded HTTP(S) page.');
    await send({type:'share',tabId:target.tabId});
    await refreshSettings();
  }catch(e){$('settings-error').textContent=e.message;}
});
$('pause-actions').addEventListener('click',async()=>{
  try{await send({type:'set-policy',paused:$('pause-actions').dataset.paused!=='true'});await refreshSettings();}
  catch(e){$('settings-error').textContent=e.message;}
});
$('open-options').addEventListener('click',()=>chrome.runtime.openOptionsPage());
