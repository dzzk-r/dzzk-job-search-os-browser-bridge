# Execution Delivery Harness

A local, user-controlled bridge between explicitly shared browser pages and an
authorized MCP client such as ChatGPT, plus an experimental operator surface
called **Browser Bridge Observer**.

By Daniel Chechik / dzzk. Independent of Mozilla, Google, OpenAI, LinkedIn and
Opera.

## Current development status

The project currently has three working surfaces around one MCP boundary:

1. **Read-only Browser Bridge** — explicit page-sharing through browser adapters.
2. **Local Executor** — bounded filesystem/process tools, blocked by default for
   newly authorized clients.
3. **Browser Bridge Observer** — a local observability/operator layer for MCP,
   terminal, OpenCode/Qwen, llama.cpp and Git activity.

The client-facing architecture is intentionally transport-neutral; see
[Clients and transports](docs/CLIENTS-AND-TRANSPORTS.md).

The read-only bridge is the baseline. The Observer is already usable locally in
Chrome and Firefox, but it is still under active development and must **not** yet
be treated as an authoritative indicator that the current ChatGPT turn is idle.

Verified locally on 2026-10-03:

- Firefox read-only bridge synthetic smoke;
- Chrome unpacked extension with live Side Panel Observer;
- Firefox Observer page;
- loopback pairing for Firefox and Chrome;
- observer timeline from completed MCP history, terminal markers, OpenCode/Qwen,
  llama.cpp and Git;
- child-process lifecycle reconstruction for tracked PIDs;
- OpenCode 1.14.48 and 1.18.34 bounded-edit compatibility smoke.

Known limitations:

- Desktop Commander writes tool history after a call returns, so an in-flight MCP
  call can be temporarily invisible;
- ChatGPT may look ready for a new message while an MCP/local execution chain is
  still running;
- authoritative CHAT TURN BUSY/IDLE/STALLED state requires the planned
  pre-dispatch MCP gateway / turn lease;
- PAUSE / BREAK / STOP ALL for the observer execution plane are not implemented;
- Firefox Sidebar and Opera observer adapters are not yet verified;
- live LinkedIn DOM, live ChatGPT OAuth linking, AMO signing/publication and
  public store release remain outside the verified scope.

See [Current status](docs/STATUS.md),
[Observer architecture](docs/OBSERVER-ARCHITECTURE.md),
[Clients and transports](docs/CLIENTS-AND-TRANSPORTS.md), and the
[cross-cutting TODO](TODO.md).

> **Repository state:** as of 2026-10-04 the active local worktree is
> `chore/local-execution` and is pushed to `origin/chore/local-execution`.
> It has not yet been reviewed/integrated into `main`.

## Version 0.1.1 baseline

The MCP server exposes four read-only page tools:
`list_tabs`, `read_page`, `find_in_page`, `bridge_status`.
Use them for browser pages you explicitly share, including visible job listings
and recruiter conversations. The bridge does not log in, crawl message history,
send messages or submit applications. Only loaded main-document text is read.

Each page is shared from the browser UI for 30 minutes. Navigation, reload, tab
closure, extension restart and manual revocation end access. Unshared tabs are
not listed. No browser history, cookie API, raw profile or form-draft export.

## Quickstart

Requires Node.js 22+ and either Firefox 140+ or a Chromium-family browser that
supports the extension APIs used by the current adapter.

Start the local companion:

```sh
git clone https://github.com/dzzk-r/execution-delivery-harness.git
cd execution-delivery-harness
npm ci
npm start
```

### Firefox

Load `firefox/manifest.json` using Firefox `about:debugging` → This Firefox →
Load Temporary Add-on. Temporary installation ends when Firefox restarts.
For permanent installation, Mozilla must sign the submitted package.

### Chrome

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked** and
select the repository's `chrome/` directory. The current Chrome adapter provides
the Browser Bridge Observer through the Side Panel API. This is a local
development path, not a Chrome Web Store release.

The companion creates one persistent extension pairing token for this local
installation. It is stored at:

`~/.config/dzzk-jso-bridge/pairing-token`

Show it in Terminal only when you actually need to read it:

```sh
cat ~/.config/dzzk-jso-bridge/pairing-token
```

On macOS, copy it without printing it:

```sh
pbcopy < ~/.config/dzzk-jso-bridge/pairing-token
```

Paste that same token into the Browser Bridge settings for every Firefox or
Chrome profile you want to pair with this companion, then accept the data-flow
disclosure. Browser profiles keep separate extension storage, so Firefox and
Chrome each need this one-time pairing even though they use the same companion
token. Restarting the companion reuses the token; it is regenerated only if the
pairing-token file is removed. Keep it out of chats and screenshots.

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
[Observer architecture](docs/OBSERVER-ARCHITECTURE.md) · [Clients and transports](docs/CLIENTS-AND-TRANSPORTS.md) ·
[Compatibility](docs/COMPATIBILITY.md) · [Cross-cutting TODO](TODO.md) · [AMO submission](docs/AMO-LISTING.md).

Opera, Safari and site-specific adapters are later work. The existing Opera
Browser Connector remains an independent third-party option. No Opera or Safari
support in this release is claimed. Other websites can be manually shared as
ordinary pages; dedicated extraction and end-to-end compatibility need testing.

MIT license. Support: GitHub issues. Do not post private browser data or tokens.
