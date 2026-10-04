const SOURCES=['MCP','TERM','OC','QWEN','LLAMA','GIT'];
const $=id=>document.getElementById(id);
const send=m=>browser.runtime.sendMessage(m);
let follow=true;

function sourceClass(source) { return 'source-'+source; }
function lastMessage(events,source) {
  for(let i=events.length-1;i>=0;i--) if(events[i].source===source) return events[i].message;
  return '-';
}
function renderLegend(active) {
  const frag=document.createDocumentFragment();
  for(const source of SOURCES) {
    const span=document.createElement('span');
    span.className='source'+(source===active?' active':'');
    const dot=document.createElement('span');
    dot.className=source===active?'activity-dot':'activity-spacer';
    dot.setAttribute('aria-hidden','true');
    const label=document.createElement('span');
    label.textContent=source;
    span.append(dot,label);
    frag.append(span);
  }
  $('legend').replaceChildren(frag);
}
function renderTimeline(state) {
  const box=$('timeline');
  const nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<24;
  const frag=document.createDocumentFragment();
  for(const event of state.timeline||[]) {
    const row=document.createElement('div'); row.className='event';
    const time=document.createElement('span'); time.textContent=new Date((event.ts||0)*1000).toLocaleTimeString();
    const src=document.createElement('span'); src.className='src'; src.textContent=event.source;
    const msg=document.createElement('span'); msg.className='msg'; msg.textContent=event.message||'';
    row.append(time,src,msg); frag.append(row);
  }
  box.replaceChildren(frag);
  if(follow || nearBottom) { box.scrollTop=box.scrollHeight; follow=true; }
  $('position').textContent='LIVE '+((state.timeline||[]).length);
}
function renderTools(state) {
  const v=state.versions||{}, events=state.timeline||[];
  const rows=[
    ['MCP','Desktop Commander '+(v.mcp||'?')+' | '+lastMessage(events,'MCP')],
    ['TERM',(v.zsh||'?')+' | '+lastMessage(events,'TERM')],
    ['OC','run='+(state.run_opencode||'-')+' default='+(v.opencode_default||'?')+' installed='+(v.opencode_parallel||'-')+' | '+lastMessage(events,'OC')],
    ['QWEN','qwen3.8-27b | '+lastMessage(events,'QWEN')],
    ['LLAMA',(v.llama||'?')+' | '+(state.llama||'?')],
    ['GIT',String(state.git_total||0)+' changed/untracked | '+(((state.git||[]).slice(0,5).join(' ; '))||'clean')],
    ['PY',v.python||'?']
  ];
  const frag=document.createDocumentFragment();
  for(const [name,detail] of rows) {
    const row=document.createElement('div'); row.className='tool-row';
    const n=document.createElement('span'); n.className='tool-name '+sourceClass(name); n.textContent=name;
    if(name===state.active_source) n.classList.add('active');
    const d=document.createElement('span'); d.textContent=detail;
    row.append(n,d); frag.append(row);
  }
  $('tools').replaceChildren(frag);
}
async function refresh() {
  try {
    const state=await send({type:'observer-state'});
    $('error').textContent='';
    $('summary').textContent=(state.state||'?')+' · run '+(state.run||'-')+' · OpenCode '+(state.run_opencode||'-')+' · llama '+(state.llama||'?')+' · git '+(state.git_total||0)+' · '+(state.last_activity_seconds??'?')+'s since activity';
    renderLegend(state.active_source);
    renderTimeline(state);
    renderTools(state);
  } catch(e) {
    $('error').textContent=e.message;
    $('summary').textContent='Observer unavailable';
  }
}
$('timeline').addEventListener('scroll',()=>{
  const box=$('timeline');
  follow=box.scrollHeight-box.scrollTop-box.clientHeight<24;
});
void refresh();
setInterval(()=>void refresh(),1500);
