document.getElementById('form').addEventListener('submit',async event=>{
  event.preventDefault();
  try {await browser.runtime.sendMessage({type:'configure',config:{enabled:true,endpoint:'http://127.0.0.1:43119',token:document.getElementById('token').value.trim()}});
    document.getElementById('token').value=''; document.getElementById('message').textContent='Configured. Open the toolbar button to check connection and share a page.';
    document.getElementById('error').textContent='';
  } catch(e) {document.getElementById('error').textContent=e.message;}
});
document.getElementById('disconnect').addEventListener('click',async()=>{
  await browser.runtime.sendMessage({type:'disconnect'}); document.getElementById('message').textContent='Disconnected. Shared pages and client connections revoked.';
});
