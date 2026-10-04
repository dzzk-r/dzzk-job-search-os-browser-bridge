# Privacy policy — Execution Delivery Harness Browser Bridge

Version 0.1.1, October 3, 2026. Developer: Daniel Chechik (dzzk).
Contact: https://github.com/dzzk-r/execution-delivery-harness/issues
Do not put private messages, page contents or credentials in public issues.

## Data flow

When you explicitly share a page, your authorized MCP client can request its
title, URL and currently rendered main-document text. Page text may contain
personal information and recruiter conversations. The extension sends this
information to your local companion at http://127.0.0.1:43119. The companion
returns requested data to the MCP client you approved in the extension.
If that client is ChatGPT, the data leaves your computer and OpenAI's policies
and your account settings apply. A tunnel provider, if used, is also in the
transport path. Data is not confined to your computer once a remote client reads it.

## Control and retention

Page sharing expires after 30 minutes. Stop sharing, navigating, reloading,
closing the tab or restarting the extension revokes the page grant. Disconnect
revokes all grants and client authorizations. Revocation prevents future reads;
it cannot retract data already returned to a client. Pause stops further requests,
cancels outstanding ones and removes shared pages. For each authorized client,
Allow, Ask every time and Block settings control each fixed read operation.

The extension keeps page grants in memory. It saves the local companion address,
enabled state, local pause and pairing token in Firefox local extension storage. The companion
stores its pairing token, OAuth client registration metadata and access policies in a local file
with owner-only permissions. Access tokens, requests and page results are processed
in memory. The application does not persist page text or log request bodies.
The operating system, proxy/tunnel and MCP client may have their own logging policies.

There is no developer-operated relay, analytics, advertising, telemetry, sale of
data or payment requirement in this project. The developer does not receive page
data. Browser/Node downloads, tunnel availability and MCP client plans are external.

## Exclusions

No cookies API, passwords API, browsing history, browser profile export, form
values, unsent editable drafts, arbitrary JavaScript, background crawling,
messages sent, or applications submitted. Readable website text can itself
contain sensitive information; only share pages you intend your client to see.

Remove the extension to delete its saved settings. Stop the companion and delete
its configuration folder to remove pairing, client metadata and access policies. Data already held
by ChatGPT or another MCP client must be managed in that client's interface.
