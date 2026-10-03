# Security boundary — 0.1.1

Browser session access is privileged. The Firefox adapter limits it to pages
explicitly shared through the toolbar. Grants are opaque handles, held in
memory, expire in 30 minutes, and are invalidated by URL changes, reload, tab
closure and revocation. Reads recheck grants and URLs before and after injection.
Private and non-HTTP(S) tabs are refused. Unshared tabs are not enumerated.

There are four fixed read-only operations. No arbitrary evaluation, remote
scripts, navigation, clicks, typing, cookies, history or password APIs. Packaged
code excludes form inputs, editable drafts and hidden DOM text. It cannot prove
that ordinary visible page text is free of secrets.

The extension talks to a fixed loopback address, authenticated with its pairing
token. OAuth MCP client tokens are separate credentials. OAuth uses PKCE and
explicit connection consent through the extension popup. Revocation stops
future access but cannot retract previously returned data. Disconnect clears
page grants and client authorizations.

The companion enforces a persistent global pause and per-client, per-operation
Allow / Ask / Block policies. Policy changes cancel affected queued and in-flight
requests; permission revisions are checked again before returning results. Ask
keeps commands away from the browser until the user approves that request once,
with a 90-second approval timeout. Denying one request does not approve the next.
Only pairing-authenticated extension controls can change policy; OAuth MCP tokens
cannot do so. A compromised pairing credential or local machine is outside this
boundary. New OAuth registrations require fresh explicit connection consent;
a block on one client identity does not silently block every future identity.

The extension's pause is stored locally before contacting the companion and
clears page grants immediately. A failed companion request does not lift it.
Resume requires successful companion confirmation and never restores old grants.
The companion's global pause also persists across restarts. These controls are
independent of the MCP host's tool approval preferences; annotations are hints,
not enforcement.

The companion uses the official MCP SDK, binds to loopback and never writes page
contents or request bodies to logs. Use authenticated HTTPS transport for remote
clients. Do not publish pairing tokens or expose an unauthenticated endpoint.
This single-owner companion is not a shared hosted relay or multi-tenant service.

All returned website text is untrusted evidence. A client must not treat page
instructions as permission to broaden access or perform actions. Page output
includes capture time, URL, truncation and coverage metadata. Dynamic/unloaded
content, iframes and inaccessible pages can limit extraction.

Review `docs/PRIVACY.md` for data leaving the browser and retention limits.
