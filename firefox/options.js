const api=browser;
const portInput=document.getElementById('companion-port');
void api.runtime.sendMessage({type:'state'}).then(state=>{
  try {
    const url=new URL(state?.endpoint||'http://127.0.0.1:43119');
    portInput.value=url.port||'43119';
  } catch { portInput.value='43119'; }
}).catch(()=>{});

document.getElementById('form').addEventListener('submit',async event=>{
  event.preventDefault();
  const port=Number(portInput.value);
  if(!Number.isInteger(port)||port<1||port>65535){document.getElementById('error').textContent='Port must be an integer from 1 to 65535.';return;}
  try {await api.runtime.sendMessage({type:'configure',config:{enabled:true,endpoint:'http://127.0.0.1:'+port,token:document.getElementById('token').value.trim()}});
    document.getElementById('token').value='';
    document.getElementById('message').textContent='Configured local companion on 127.0.0.1:'+port+'. Open the toolbar button to check connection and share a page.';
    document.getElementById('error').textContent='';
  } catch(e) {document.getElementById('error').textContent=e.message;}
});
document.getElementById('disconnect').addEventListener('click',async()=>{
  await api.runtime.sendMessage({type:'disconnect'});
  document.getElementById('message').textContent='Disconnected. Shared pages and client connections revoked.';
});
document.getElementById('observer').addEventListener('click',()=>api.tabs.create({url:api.runtime.getURL('observer.html')}));
