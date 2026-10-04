importScripts('core.js','read-page.js','background.js');
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});
}
