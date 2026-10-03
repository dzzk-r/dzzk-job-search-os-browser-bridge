(function(root) {
  class Grants {
    constructor() { this.tabs = new Map(); }
    share(tab, now = Date.now()) {
      if (!['http:', 'https:'].includes(new URL(tab.url).protocol) || tab.incognito) throw new Error('Only normal HTTP(S) tabs can be shared.');
      const handle = crypto.randomUUID();
      this.revoke(tab.id);
      this.tabs.set(tab.id, { handle, tabId: tab.id, url: tab.url, title: tab.title || '', grantedAt: now, expiresAt: now + 1800000 });
      return handle;
    }
    revoke(id) { this.tabs.delete(id); }
    clear() { this.tabs.clear(); }
    list(now = Date.now()) {
      for (const [id, g] of this.tabs) if (g.expiresAt <= now) this.revoke(id);
      return [...this.tabs.values()].map(({ tabId, ...g }) => g);
    }
    get(handle, now = Date.now()) {
      this.list(now);
      const g = [...this.tabs.values()].find(x => x.handle === handle);
      if (!g) throw new Error('Tab is not shared or access expired. Share it again in Firefox.');
      return g;
    }
    check(handle, tab, now = Date.now()) {
      const g = this.get(handle, now);
      if (tab.id !== g.tabId || tab.url !== g.url || tab.status === 'loading' || tab.incognito) {
        this.revoke(g.tabId); throw new Error('Page changed. Share this page again in Firefox.');
      }
      return g;
    }
  }
  root.DzzkGrants = Grants;
})(globalThis);
