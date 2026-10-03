/* dzzk Job Search OS Browser Bridge
 * Bootstrap only: no remote transport is enabled yet.
 */

browser.runtime.onInstalled.addListener(() => {
  console.log("dzzk Job Search OS Browser Bridge installed");
});

browser.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  const key = `sharedTab:${tab.id}`;
  const current = await browser.storage.local.get(key);
  const next = !current[key];

  await browser.storage.local.set({ [key]: next });

  await browser.action.setBadgeText({
    tabId: tab.id,
    text: next ? "ON" : ""
  });
});
