const $ = id => document.getElementById(id), send = m => chrome.runtime.sendMessage(m);
const safely = fn => async () => {try {$('error').textContent=''; await fn(); await refresh();} catch(e) {$('error').textContent=e.message;}};
function card(parent,text,buttons) {
  const div=document.createElement('div'); div.className='card';
  const p=document.createElement('p'); p.textContent=text; div.append(p);
  for (const [label,fn] of buttons) {const b=document.createElement('button'); b.textContent=label; b.addEventListener('click',safely(fn)); div.append(b);}
  parent.append(div); return div;
}
async function refresh() {
  const s=await send({type:'state'}); $('status').textContent=s.status; $('share').disabled=s.status!=='Connected' || s.paused; $('pause').textContent=s.paused?'Resume actions':'Pause all actions'; $('pause').dataset.paused=String(s.paused);
  $('grants').replaceChildren(); $('consents').replaceChildren(); $('clients').replaceChildren(); $('actions').replaceChildren();
  for(const c of s.consents) card($('consents'),`Connection request: ${c.name}. Callback: ${c.redirectOrigin}. Read shared pages only.`,[
    ['Allow',()=>send({type:'consent',id:c.id,allow:true})],['Deny',()=>send({type:'consent',id:c.id,allow:false})]]);
  const methods={
    'tabs.list':'List shared pages','page.read':'Read page text','page.find':'Find a passage','bridge.status':'Check connection',
    'local.status':'Local executor status','local.list_dir':'List local directory','local.read_file':'Read local file',
    'local.write_file':'Write local file','local.exec_start':'Start local command','local.process_output':'Read local process output','local.process_stop':'Stop local process'
  };
  const localMethods=new Set(['local.status','local.list_dir','local.read_file','local.write_file','local.exec_start','local.process_output','local.process_stop']);
  for(const a of s.actions) {
    const g=s.grants.find(g=>g.handle===a.target);
    card($('actions'),`${a.clientName} requests: ${methods[a.method]||a.method}. ${g ? g.title+' — '+g.url : a.target}`,[
      ['Allow once',()=>send({type:'action-consent',id:a.id,allow:true})],['Deny once',()=>send({type:'action-consent',id:a.id,allow:false})]]);
  }
  for(const c of s.clients) {
    const div=card($('clients'),`Authorized: ${c.name} (${c.redirectOrigin})`,[['Revoke connection',()=>send({type:'revoke-client',id:c.id})]]);
    for(const [method,title] of Object.entries(methods)) {
      const label=document.createElement('label'); label.textContent=title+' ';
      const select=document.createElement('select'); select.dataset.method=method;
      for(const [mode,text] of (localMethods.has(method) ? [['allow','Allow'],['block','Block']] : [['allow','Allow'],['ask','Ask every time'],['block','Block']])) {
        const option=document.createElement('option'); option.value=mode; option.textContent=text; select.append(option);
      }
      select.value=c.permissions?.[method]||'allow';
      select.addEventListener('change',safely(()=>send({type:'set-policy',clientId:c.id,method,mode:select.value})));
      label.append(select); div.append(label);
    }
  }
  for(const g of s.grants) card($('grants'),`${g.title||'Shared page'}\n${g.url}`,[['Stop sharing',()=>send({type:'revoke',handle:g.handle})]]);
}
$('share').addEventListener('click',safely(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true}); await send({type:'share',tabId:tab.id});}));
$('pause').addEventListener('click',safely(()=>send({type:'set-policy',paused:$('pause').dataset.paused!=='true'})));
$('disconnect').addEventListener('click',safely(()=>send({type:'disconnect'})));
$('observer').addEventListener('click',()=>chrome.tabs.create({url:chrome.runtime.getURL('observer.html')}));
$('settings').addEventListener('click',()=>chrome.runtime.openOptionsPage());
void refresh().catch(e=>{$('error').textContent=e.message;}); setInterval(()=>{if(document.activeElement?.tagName!=='SELECT') void refresh().catch(()=>{});},1500);
