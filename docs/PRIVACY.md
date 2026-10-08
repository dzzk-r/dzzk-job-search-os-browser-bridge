# Privacy policy — Execution Delivery Harness Browser Bridge

Current development policy version: **0.1.41**, October 9, 2026.
Developer: Daniel Chechik (dzzk).
Contact: https://github.com/dzzk-r/execution-delivery-harness/issues

Do not put private messages, page contents, pairing tokens or credentials in public issues.

## Explicitly shared pages

When you explicitly share a page, an authorized MCP client can request its title, URL and currently rendered main-document text through the fixed Browser Bridge read operations. Page text can contain personal or sensitive information.

The extension sends requested evidence to the owner-local companion on loopback (`http://127.0.0.1:<configured-port>`, default `43119`). The companion returns requested data only to an explicitly authorized MCP client allowed by the current operation policy.

If that client is remote, such as ChatGPT through a supported MCP transport, returned page evidence leaves the computer and the remote client's policies/account settings apply. A tunnel/transport provider, when intentionally used, may also be in the path.

## ChatGPT Web observation and token estimation

The Chrome adapter observes supported ChatGPT Web conversation/turn structure for local Observer attribution and lifecycle display.

For browser-turn token accounting, EDH may read the **visible text of the most recent user message and most recent assistant message locally in the content script** when a turn reaches DONE. It uses their UTF-8 byte lengths to produce an explicitly labeled local estimate (`utf8-bytes-per-token-v1`).

The usage record contains estimates and observable byte counts. The message text itself is **not included in the usage record and is not persisted by this estimator**.

This estimate is not authoritative server-side ChatGPT usage. Hidden system context, tool schemas, server-side prompt assembly/cache and billed token usage are unavailable unless a provider/runtime explicitly reports them.

This local turn-estimation path is separate from explicit Browser Bridge page sharing. Observing a ChatGPT turn does not create a general grant to export other browser pages.

## Control and retention

Page sharing expires after 30 minutes. Stop sharing, navigation, reload, tab closure, extension restart or manual revocation ends the page grant. Disconnect revokes all grants and client authorizations. Revocation prevents future reads; it cannot retract data already returned to a client.

Pause stops further Browser Bridge actions, cancels affected outstanding work and removes shared pages. Allow / Ask / Block policies control fixed operations for each authorized client.

The extension keeps active page grants in memory. It stores local configuration, pause state, pairing material and Observer/browser binding state in browser extension storage as required for the local workflow. The companion stores its pairing token, OAuth/client registration metadata and access policies under the owner's local configuration directory with restrictive permissions.

The Browser Bridge does not intentionally persist shared page text or request bodies as part of its normal read path. Observer/event records may persist operation metadata, timing, provenance, lifecycle state and usage/accounting metadata. The browser-visible token estimator persists/forwards estimates and byte counts, not the message text used to derive them.

The operating system, browser, MCP host, model/runtime, proxy/tunnel provider and remote client may have their own logging/retention policies outside EDH's local boundary.

## Model/provider usage telemetry

When a model/runtime reports usage, EDH can preserve normalized metadata such as provider/model identity, input/output/total tokens, cache read/write counts, output throughput, cost metadata and provenance labels such as `exact`, `derived`, `estimated` or `unavailable`.

EDH must not present an estimated value as provider-reported truth. Historical usage backfill is written as a separate derived artifact and does not rewrite the original raw model response.

## Exclusions

The Browser Bridge does not request cookie, password or browser-history APIs; it does not export the browser profile; it excludes form inputs and unsent editable drafts from the normal page-read evidence path; and it does not provide arbitrary remote JavaScript execution through the browser-read contract.

The read-only Browser Bridge does not send messages or submit applications. Local Executor tools are a separate authorization domain and must not be inferred from browser-read permission.

Readable/visible page or ChatGPT text can itself contain sensitive information. Only share pages with clients you intend to receive that evidence, and treat the local machine/browser profile as part of the trust boundary.

## Developer-operated services

This project does not require a developer-operated relay, analytics service, advertising service or paid browser-automation subscription. The developer does not receive page data merely because the extension is installed. External MCP, model, hosting or tunnel providers have their own terms and data policies.

## Removal

Use the extension's disconnect/revoke controls before removal when possible. Stop the companion and remove its local configuration directory only when you intentionally want to destroy this machine's pairing/client state.

Data already received by ChatGPT or another external client must be managed in that client's interface/policy domain.
