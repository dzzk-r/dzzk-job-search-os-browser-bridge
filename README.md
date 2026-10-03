# Execution Delivery Harness

Controlled delivery of agent actions into user-owned execution environments.
The current reference implementation connects ChatGPT/MCP to explicitly shared browser pages, with Job Search OS as the first real-world consumer.
By Daniel Chechik. Independent of Mozilla, OpenAI, LinkedIn, Google and Opera.

## Version 0.1.1

Firefox extension + local Node.js companion. Four read-only tools:
`list_tabs`, `read_page`, `find_in_page`, `bridge_status`.
Use it for visible job listings and recruiter conversations, including LinkedIn
pages you already have open. The bridge does not log in, crawl message history,
send messages or submit applications. Only loaded main-document text is read.

Each page is shared from the toolbar for 30 minutes. Navigation, reload, tab
closure, extension restart and manual revocation end access. Unshared tabs are
not listed. No browser history, cookie API, raw profile or form-draft export.

## Quickstart

Requires Firefox 140+ and Node.js 22+. The companion is a separate installation:

```sh
git clone https://github.com/dzzk-r/execution-delivery-harness.git
cd execution-delivery-harness
npm ci
npm start
```

Load `firefox/manifest.json` using Firefox `about:debugging` → This Firefox →
Load Temporary Add-on. Temporary installation ends when Firefox restarts.
For permanent installation, Mozilla must sign the submitted package.

Paste the companion's extension pairing token into the extension settings and
accept the data-flow disclosure. Keep that token out of chats and screenshots.
Open the toolbar button and check that the companion is Connected.

### ChatGPT

Installing the extension alone does not connect ChatGPT. ChatGPT needs a
supported developer-mode MCP connection to the companion. For a public HTTPS
transport, set `PUBLIC_URL` to your tunnel's stable HTTPS origin before starting
`npm start`, and point the tunnel at `http://127.0.0.1:43119`. Connect ChatGPT to
`https://YOUR-ORIGIN/mcp` with OAuth / dynamic client registration. Keep the
companion bound to loopback. Alternatively a supported private MCP tunnel can
reach the local server; availability depends on your account and workspace.

During OAuth linking, open the extension popup and approve the displayed client
and callback origin. Then open your job page and click Share this page.
Ask the client to list shared tabs, read one by its opaque handle, or find text.
Stop sharing to block subsequent reads. Disconnect also revokes client tokens.

The browser path has no required paid automation service. ChatGPT, hosting and
transport providers have their own account, plan and availability requirements.

## Stop and approval controls

In the extension popup, use Pause all actions to stop every client, cancel queued
or in-flight requests, and remove page grants. Resume does not restore grants;
share each page again. Local pause stays effective if the companion is unavailable.

Each authorized client has four permission selectors: list shared pages, read page
text, find passages and check connection. Allow performs that operation within
existing page grants. Ask every time holds each request until you choose Allow
once or Deny once in Firefox; an approval is never reused. Block refuses that
operation until you change it. New authorized clients default to Allow after the
explicit connection approval. Choose Ask or Block before sharing pages if desired.

Only extension UI can change these settings; MCP client credentials cannot.
Policies persist in the local companion and survive reauthorization of the same
registered client. A newly registered client needs fresh connection approval.
Revoking a connection removes its tokens. Stop and revoke cannot retract data
already returned to a client. ChatGPT's own plugin approval settings are an
additional, independent control.

## Development

```sh
npm test
npm run lint
npm run build
FIREFOX_BIN=/path/to/firefox npm run test:firefox
```

`dist/dzzk_job_search_os_browser_bridge-0.1.1.zip` is the unsigned AMO submission
package. An unsigned ZIP is not an approved AMO release. Firefox smoke testing
uses a disposable profile and synthetic pages, never personal browser sessions.

## Boundaries and next adapters

[Privacy](docs/PRIVACY.md) · [Security](docs/SECURITY-BOUNDARY.md) · [Controls](docs/CONTROL-MODEL.md) ·
[Compatibility](docs/COMPATIBILITY.md) · [AMO submission](docs/AMO-LISTING.md).

Chrome/Chromium, Opera, Safari and site-specific adapters are later work. The existing Opera
Browser Connector remains an independent third-party option. No Chrome, Opera or Safari
adapter support in this release is claimed. Other websites can be manually shared as
ordinary pages; dedicated extraction and end-to-end compatibility need testing.

MIT license. Support: GitHub issues. Do not post private browser data or tokens.
