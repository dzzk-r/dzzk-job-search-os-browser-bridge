const $ = id => document.getElementById(id), send = m => browser.runtime.sendMessage(m);
const safely = fn => async () => {try {$('error').textContent=''; await fn(); await refresh();} catch(e) {$('error').textContent=e.message;}};
function card(parent,text,buttons) {
  const div=document.createElement('div'); div.className='card';
  const p=document.createElement('p'); p.textContent=text; div.append(p);
  for (const [label,fn] of buttons) {const b=document.createElement('button'); b.textContent=label; b.addEventListener('click',safely(fn)); div.append(b);}
  parent.append(div);
}
async function refresh() {
  const s=await send({type:'state'}); $('status').textContent=s.status; $('share').disabled=s.status!=='Connected';
  $('grants').replaceChildren(); $('consents').replaceChildren(); $('clients').replaceChildren();
  for(const c of s.consents) card($('consents'),`Connection request: ${c.name}. Callback: ${c.redirectOrigin}. Read shared pages only.`,[
    ['Allow',()=>send({type:'consent',id:c.id,allow:true})],['Deny',()=>send({type:'consent',id:c.id,allow:false})]]);
  for(const c of s.clients) card($('clients'),`Authorized: ${c.name} (${c.redirectOrigin})`,[['Revoke connection',()=>send({type:'revoke-client',id:c.id})]]);
  for(const g of s.grants) card($('grants'),`${g.title||'Shared page'}\n${g.url}`,[['Stop sharing',()=>send({type:'revoke',handle:g.handle})]]);
}
$('share').addEventListener('click',safely(async()=>{const [tab]=await browser.tabs.query({active:true,currentWindow:true}); await send({type:'share',tabId:tab.id});}));
$('disconnect').addEventListener('click',safely(()=>send({type:'disconnect'})));
$('settings').addEventListener('click',()=>browser.runtime.openOptionsPage());
void refresh().catch(e=>{$('error').textContent=e.message;}); setInterval(()=>{void refresh().catch(()=>{});},1500);
