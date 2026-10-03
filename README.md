# dzzk Job Search OS — Browser Bridge

Read explicitly shared pages from an existing Firefox session through MCP.
By Daniel Chechik / dzzk. Independent of Mozilla, OpenAI, LinkedIn and Opera.

## Version 0.1.0

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
git clone https://github.com/dzzk-r/dzzk-job-search-os-browser-bridge.git
cd dzzk-job-search-os-browser-bridge
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

## Development

```sh
npm test
npm run lint
npm run build
FIREFOX_BIN=/path/to/firefox npm run test:firefox
```

`dist/dzzk_job_search_os_browser_bridge-0.1.0.zip` is the unsigned AMO submission
package. An unsigned ZIP is not an approved AMO release. Firefox smoke testing
uses a disposable profile and synthetic pages, never personal browser sessions.

## Boundaries and next adapters

[Privacy](docs/PRIVACY.md) · [Security](docs/SECURITY-BOUNDARY.md) ·
[Compatibility](docs/COMPATIBILITY.md) · [AMO submission](docs/AMO-LISTING.md).

Opera, Safari and site-specific adapters are later work. The existing Opera
Browser Connector remains an independent third-party option. No Opera or Safari
support in this release is claimed. Other websites can be manually shared as
ordinary pages; dedicated extraction and end-to-end compatibility need testing.

MIT license. Support: GitHub issues. Do not post private browser data or tokens.
