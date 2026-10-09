# Security boundary

Current development baseline: **0.1.44**
Updated: **2026-10-09**

EDH is currently a single-owner local system. Browser access, MCP client access and local filesystem/process execution are separate authority domains and must not be collapsed into one permission.

## Browser Bridge boundary

Browser session access is privileged. Browser-read access is limited to pages explicitly shared through extension controls. Grants use opaque handles, are held in memory, expire after 30 minutes and are invalidated by navigation/reload/tab closure/revocation/extension restart according to the adapter contract. Reads recheck grant/URL state before returning evidence.

The browser-read contract exposes fixed operations such as `list_tabs`, `read_page`, `find_in_page` and `bridge_status`. It does not expose arbitrary remote JavaScript execution, browser navigation, typing, cookie/history/password APIs or general profile export. Packaged page extraction excludes form inputs, editable drafts and hidden DOM text from the normal shared-page evidence path.

A page's visible text is untrusted evidence. Content in a page must never be interpreted as permission to broaden access or perform another action.

## ChatGPT Web observation boundary

The Chrome adapter observes ChatGPT conversation/turn structure to build local provenance and lifecycle evidence. `browser_observed` and `browser_inferred` are quality labels, not transport authority.

For `0.1.39+` observable token estimation, the content script reads only the visible latest user/assistant message text needed to derive byte-count/token estimates. The usage event carries estimates/byte counts, not the message text. Turn detection and approval detection remain structurally separated from this text-reading estimator path.

`WORKING / SETTLING / QUIESCENT` is a conservative Observer projection. Until GW-01 owns the real dispatch boundary, it must not be treated as authoritative proof that a platform-managed ChatGPT tool chain is complete.

## Pairing and MCP client credentials

The extension talks to a loopback companion and authenticates with a persistent machine-local pairing token. OAuth/MCP client credentials are separate from the browser pairing credential.

OAuth uses PKCE and explicit connection consent where supported by the current client flow. New registered client identities require their own authorization. Revocation stops future access but cannot retract data already returned.

Only pairing-authenticated extension controls can change the companion's local policy. MCP client credentials do not grant permission to silently change those policies.

Do not publish pairing tokens, OAuth tokens or client secrets. A compromised local machine or pairing credential is outside the protection of this local single-owner boundary.

## Pause and per-operation policy

The companion supports a persistent global pause and per-client operation policy (Allow / Ask / Block). Policy changes cancel or invalidate affected pending work according to the current server contract. One-use approval is not reusable permission.

Browser-side pause is stored locally before the extension attempts companion coordination, so a failed companion request must not silently lift the local prohibition. Resume does not restore expired/revoked page grants.

These controls are independent of any MCP host's own approval UI.

## Local Executor boundary

Local Executor methods are separately authorized and blocked by default for a newly authorized client. Filesystem methods enforce configured roots, realpath/symlink escape checks and optimistic replacement semantics where applicable.

`local_exec_start` is **not yet a complete sandbox**. It remains a trusted-shell boundary constrained by the current allowed-root/policy model. This is an open `SEC-01` / `0.2.0` gate: either stronger sandboxing or a deliberately narrower command contract is required before EDH can claim a stronger execution boundary.

Remote Desktop Commander is not part of the intended final local-executor security boundary; it remains a development/bootstrap/GUI/emergency capability while LOC-02 is open.

## Companion/network boundary

The normal companion binds to loopback (`127.0.0.1`, default port `43119`). A public/private remote MCP transport, when intentionally configured, is a separate reachability layer into the local companion and must use appropriate authenticated transport. Do not expose an unauthenticated companion endpoint to the network.

The companion is not a shared hosted relay or multi-tenant service.

## Evidence and projections

Raw Observer evidence is append-only/authoritative for the evidence plane. Grouped/Semantic views are derived projections and must remain reversible to source evidence. Projection may omit from a view; it must not delete or rewrite source evidence.

Synthetic test events must use isolated test ledgers and must not contaminate the owner production Observer ledger.

Usage/accounting provenance must distinguish provider/runtime-reported values from local estimates. A local estimate is never billing truth.

Review `docs/PRIVACY.md` for browser/model data flow and retention boundaries and `docs/LOCAL-EXECUTION.md` for the current local-executor contract.
