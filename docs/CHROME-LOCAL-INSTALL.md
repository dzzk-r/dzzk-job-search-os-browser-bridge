# Chrome local installation and Side Panel startup

Status: **canonical local-development installation guide**
Current baseline: **0.1.45**
Updated: **2026-10-09**

This guide describes the smallest supported owner-local setup for loading the
Execution Delivery Harness Browser Bridge from this repository and opening its
Chrome Side Panel Observer.

It intentionally separates the **required Chrome/companion path** from optional
MCP clients, local models and agent runtimes. `llama.cpp`, Ollama, OpenCode and a
standalone Observer process are **not prerequisites** for opening and using the
Chrome Side Panel.

## 1. What this installation provides

The minimum local stack is:

```text
Chrome
  -> unpacked extension from <repo>/chrome/
  -> Side Panel Observer
  -> pairing-authenticated loopback connection
  -> node server/index.mjs
  -> http://127.0.0.1:43119
```

The companion serves Browser Bridge control/telemetry, Observer snapshots,
pairing/client policy and the local MCP surfaces. The Side Panel is a projection
over that local control/observation plane.

Installing the Chrome extension does **not** by itself connect a remote ChatGPT
MCP client. Remote/private MCP transport setup is a separate layer described in
`docs/CLIENTS-AND-TRANSPORTS.md`.

## 2. Prerequisites

Required:

- Git;
- Node.js **22 or newer**;
- npm;
- Google Chrome or another Chromium-family browser with Manifest V3 Side Panel
  support;
- a local checkout of this repository.

Check Node/npm:

```sh
node --version
npm --version
```

The repository declares `node >=22` in `package.json`.

Optional and not required for the basic Side Panel:

- `llama-server` / llama.cpp;
- Ollama;
- OpenCode;
- ChatGPT Desktop/Codex local plugin;
- a public HTTPS MCP tunnel;
- a separately running `scripts/run-observer.py` TUI.

## 3. Clone and install dependencies

Fresh clone:

```sh
git clone https://github.com/dzzk-r/execution-delivery-harness.git
cd execution-delivery-harness
npm ci
```

For the current owner development worktree:

```sh
cd ~/WORK/_bridge-local-execution
npm ci
```

`npm ci` installs the exact dependency set from `package-lock.json`.

Optional preflight:

```sh
npm test
```

At the 0.1.45 baseline the automated suite is **141/141 passing**.

## 4. Start the local companion

From the repository root:

```sh
npm start
```

This resolves to:

```text
node --env-file-if-exists=.env server/index.mjs
```

Default endpoint:

```text
http://127.0.0.1:43119
```

The port is resolved in this order:

1. explicit server option used by tests/internal callers;
2. `EDH_COMPANION_PORT`;
3. default `43119`.

A project-local `.env` may override the port:

```text
EDH_COMPANION_PORT=43119
```

The Chrome extension and companion must use the same port.

### Verify the companion

In another terminal:

```sh
curl http://127.0.0.1:43119/health
```

A healthy response is JSON containing the Browser Bridge service identity and
mode. `/health` proves that the loopback server is alive; it does not prove that
CHAT, MCP, RDC, OpenCode or a model is currently active.

The companion is currently a foreground process. This repository does not yet
provide a canonical launchd/systemd/service-manager installation.

## 5. Pairing token

On first start, the companion creates a persistent local pairing token at:

```text
~/.config/dzzk-jso-bridge/pairing-token
```

The config directory is machine-local. Do not commit or publish its contents.

On macOS, copy the token without printing it:

```sh
pbcopy < ~/.config/dzzk-jso-bridge/pairing-token
```

If `pbcopy` is unavailable, read the file locally and handle it as a secret.
Never paste the token into issues, documentation, screenshots or chat messages.

Restarting the companion reuses the token. Deleting the token is a credential
reset and requires browser profiles to pair again.

## 6. Load the Chrome extension

Open:

```text
chrome://extensions
```

Then:

1. enable **Developer mode**;
2. choose **Load unpacked**;
3. select the repository's **`chrome/` directory**, not the repository root.

Example for the current owner worktree:

```text
/Users/dzzk/WORK/_bridge-local-execution/chrome
```

The current manifest is Manifest V3 and declares:

- extension name: `Execution Delivery Harness Browser Bridge`;
- version: `0.1.45`;
- permissions: `activeTab`, `scripting`, `storage`, `alarms`, `sidePanel`;
- loopback host permission: `http://127.0.0.1/*`;
- ChatGPT content-script scope: `https://chatgpt.com/*`;
- Side Panel entry: `observer.html`;
- options page: `options.html`.

On first install Chrome opens the extension Options page automatically.

## 7. Connect the browser profile to the companion

In the Options page:

1. leave **Local control / observation plane port** at `43119` unless the
   companion was started with another `EDH_COMPANION_PORT`;
2. paste the pairing token;
3. read and accept the local data-flow disclosure;
4. choose **Connect companion**.

Each Chrome profile has separate extension storage and therefore must be paired
once even when profiles use the same local companion.

Pairing is not the same as granting page access. Browser page grants remain
explicit, temporary and revocable.

## 8. Open the Side Panel

The extension configures Chrome's Side Panel behavior so clicking its toolbar
action opens the Observer:

```text
chrome.action click
  -> chrome.sidePanel
  -> observer.html
```

If the extension icon is hidden, pin **Execution Delivery Harness Browser
Bridge** from Chrome's Extensions menu, then click it.

Expected first-level UI includes:

- extension version (`v0.1.45` at this baseline);
- actor strip (`CHAT`, `MCP`, `RDC`, `TERM`, `OC`, `QWEN`, `LLAMA`, `GIT`);
- Unified timeline;
- `Raw / Grouped / Semantic` views;
- `LIVE` plus `WORKING / SETTLING / QUIESCENT` observer-inferred boundary state;
- Current task / Run / Project-readiness surfaces when corresponding evidence
  exists.

Actor presence does not mean that every actor/runtime is installed or currently
used. It is an Observer vocabulary/registry.

## 9. Verify the installation

A useful minimum acceptance sequence is:

1. `npm start` remains running;
2. `curl http://127.0.0.1:43119/health` succeeds;
3. `chrome://extensions` shows the unpacked extension enabled;
4. the loaded extension version matches the repository manifest;
5. the Options page reports a configured local companion;
6. clicking the toolbar action opens the Side Panel;
7. the Side Panel can refresh its Observer snapshot without a companion-offline
   error;
8. opening a `https://chatgpt.com/c/<conversation_id>` page causes CHAT context
   evidence to appear after the browser detector observes activity.

For browser-read MCP acceptance, additionally share a disposable page explicitly
and verify `list_tabs` / `read_page`; that requires an authorized MCP client and
is outside the minimum Side Panel installation.

## 10. Updating an unpacked installation

The unpacked development build is loaded from files on disk. Updating the Git
checkout does not automatically replace the already loaded extension runtime.

Recommended update flow:

```sh
cd <repo>
git pull --ff-only        # or update the intended development branch/worktree
npm ci                    # required when package-lock.json changed; safe otherwise
npm test                  # recommended before live acceptance
```

Then:

1. restart `npm start` if `server/`, companion configuration or Node-side runtime
   code changed;
2. reload the extension when `chrome/` or manifest files changed.

The Side Panel compares the loaded extension version with the version on disk.
When they differ it exposes an explicit `Reload <loaded> -> <disk>` action. That
user action is the preferred project UI for a versioned reload. Chrome's
`chrome://extensions` **Reload** button remains the manual fallback.

A gateway restart does **not** imply or perform an extension reload.

Existing explicit page grants are ephemeral and may need to be re-granted after
an extension reload/restart.

## 11. Stopping and restarting

Stop the foreground companion with `Ctrl-C` in the terminal where `npm start` is
running.

Starting it again with `npm start` reuses the pairing token and persisted client
policy. Browser extension local storage persists across ordinary browser
restarts, but active page grants are intentionally ephemeral.

The Side Panel may remain open while the companion is stopped; it should report
the control plane as offline/degraded rather than inventing activity.

## 12. Uninstall / reset

To remove only the Chrome adapter, use `chrome://extensions` -> **Remove**.

To revoke the browser profile before removal, use the extension Options page
**Disconnect and revoke all**.

Machine-local companion credentials live under:

```text
~/.config/dzzk-jso-bridge/
```

Do not delete that directory casually on a development machine: it resets pairing
and authorized-client state. A clean-machine uninstall/bootstrap automation does
not yet exist and remains tracked under portable onboarding work.

## 13. Troubleshooting

### Side Panel opens but says companion/offline

Check:

```sh
curl http://127.0.0.1:43119/health
```

Then confirm the Options-page port matches `EDH_COMPANION_PORT` / the running
companion.

### Pairing fails

Confirm that the token came from the same machine/companion instance and has not
been regenerated. Re-copy it from the local pairing-token file rather than
sharing it through chat.

### Clicking the extension icon does not open the Side Panel

Confirm that the unpacked extension is enabled and that Chrome loaded the
repository's `chrome/` directory. Reload the extension from
`chrome://extensions` and retry.

### Loaded version differs from repository version

Use the Side Panel's explicit version reload action or Chrome's extension Reload
button. Do not restart the gateway merely to reload browser JavaScript/HTML/CSS.

### `LIVE` is gray while new events later appear

`LIVE` reports positive activity evidence, not an authoritative transport-level
end-of-turn signal. `WORKING / SETTLING / QUIESCENT` is a separate conservative
boundary projection. Until GW-01 owns the real dispatch boundary it remains
explicitly `observer_inferred`.

### Token/usage fields are absent

Usage is shown only where evidence exists. Provider/runtime-reported values are
labeled `exact`; derived or browser-visible estimates are labeled accordingly.
The Browser Bridge must not invent server-side ChatGPT usage that the platform
does not expose.

## 14. Related documentation

- `README.md` — project entry point and current development summary;
- `docs/STATUS.md` — current implementation/test status;
- `docs/LOCAL-CONTROL-OBSERVATION-PLANE.md` — companion identity and endpoint;
- `docs/LOCAL-STACK-ONBOARDING-DRAFT.md` — broader second-machine inventory;
- `docs/CLIENTS-AND-TRANSPORTS.md` — MCP client/transport boundary;
- `docs/SECURITY-BOUNDARY.md` — trust and credential boundary;
- `docs/PRIVACY.md` — browser data handling;
- `TODO.md` — authoritative engineering task catalog.
