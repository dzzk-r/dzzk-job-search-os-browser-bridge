(function(root) {
  class Grants {
    constructor() { this.tabs = new Map(); }
    share(tab, now = Date.now()) {
      let protocol;
      try { protocol = typeof tab.url === 'string' ? new URL(tab.url).protocol : null; } catch {}
      if (!['http:', 'https:'].includes(protocol) || tab.incognito) throw new Error('Only normal HTTP(S) tabs can be shared.');
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
      if (!g) throw new Error('Tab is not shared or access expired. Share it again in the browser.');
      return g;
    }
    check(handle, tab, now = Date.now()) {
      const g = this.get(handle, now);
      if (tab.id !== g.tabId || tab.url !== g.url || tab.status === 'loading' || tab.incognito) {
        this.revoke(g.tabId); throw new Error('Page changed. Share this page again in the browser.');
      }
      return g;
    }
  }
  root.DzzkGrants = Grants;
})(globalThis);

(function(root) {
  class ConversationBindings {
    constructor(entries = []) {
      this.tabs = new Map();
      for (const item of entries || []) {
        if (!item || !Number.isInteger(item.tabId) || typeof item.conversation_id !== 'string') continue;
        this.tabs.set(item.tabId, {...item});
      }
    }
    static assertChatGpt(tab) {
      let url;
      try { url = new URL(tab.url); } catch {}
      if (!url || url.protocol !== 'https:' || !(url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com')) || tab.incognito) {
        throw new Error('Only normal ChatGPT HTTPS tabs can be bound to a conversation.');
      }
      if (tab.status === 'loading') throw new Error('Wait for the ChatGPT tab to finish loading before binding.');
      return url;
    }
    static conversationId(tab) {
      const url=ConversationBindings.assertChatGpt(tab);
      const parts=url.pathname.split('/').filter(Boolean);
      const at=parts.lastIndexOf('c');
      const id=at>=0 ? parts[at+1] : null;
      if(typeof id!=='string' || !/^[A-Za-z0-9_-]{6,160}$/.test(id)) {
        throw new Error('Open a saved ChatGPT conversation (/c/<id>) before binding.');
      }
      return id;
    }
    bind(tab, now = Date.now()) {
      const conversation_id=ConversationBindings.conversationId(tab);
      const existing = this.tabs.get(tab.id);
      if (existing && existing.url === tab.url && existing.conversation_id === conversation_id) return {...existing};
      const binding = {
        tabId:tab.id,
        conversation_id,
        url:tab.url,
        title:tab.title || '',
        boundAt:now,
        source_quality:'browser_observed'
      };
      this.tabs.set(tab.id,binding);
      return {...binding};
    }
    getByTab(tab, now = Date.now()) {
      const binding=this.tabs.get(tab.id);
      if(!binding) return null;
      if(tab.incognito || tab.status==='loading' || tab.url!==binding.url) {
        this.tabs.delete(tab.id); return null;
      }
      return {...binding,lastSeenAt:now};
    }
    revoke(tabId){ return this.tabs.delete(tabId); }
    list(){ return [...this.tabs.values()].map(x=>({...x})); }
    serialize(){ return this.list(); }
  }
  root.DzzkConversationBindings = ConversationBindings;
})(globalThis);
