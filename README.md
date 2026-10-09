# Execution Delivery Harness

Execution Delivery Harness (EDH) is a local, user-controlled bridge and execution
substrate for explicitly authorized browser/local work, with a live Browser
Bridge Observer for evidence, provenance and execution state.

By Daniel Chechik / dzzk. Independent of Mozilla, Google, OpenAI, LinkedIn and
Opera.

> **AI/runtime disclosure rule:** ChatGPT, Codex and all project agents must follow
> the mandatory IP/external-disclosure boundary in [`AGENTS.md`](AGENTS.md).
> Private app registration never implies permission to publish or disclose project
> internals.

## Current baseline

- package / Chrome / Firefox development version: **0.1.42**;
- active development branch/worktree: `chore/local-execution`;
- automated suite: **148/148 passing** on 2026-10-09;
- next readiness milestone: `owner-local-v0` (currently blocked);
- pre-1.0 release interpretation: `0.1.x` is the owner-local
  Observer/foundation line; `0.2.0` requires the owner-local routine execution
  loop without Remote Desktop Commander on the normal critical path.

See [`docs/STATUS.md`](docs/STATUS.md) for the current implementation snapshot and
[`docs/PRE-1.0-RELEASE-MILESTONE-MODEL.md`](docs/PRE-1.0-RELEASE-MILESTONE-MODEL.md)
for release-capability semantics.

## Working layers

1. **Read-only Browser Bridge** — explicit temporary page grants and browser-read
   MCP tools.
2. **Local Executor** — bounded filesystem/process primitives behind explicit
   policy; trusted-shell isolation work remains incomplete.
3. **Browser Bridge Observer** — immutable raw event ledger plus reversible
   `Raw / Grouped / Semantic` projections in Chrome Side Panel/TUI surfaces.
4. **Gateway/orchestration substrate** — correlation, browser-observed ChatGPT
   turn evidence, detached/prepared dispatch, lifecycle state and knowledge/context
   injection.

Current Chrome Observer capabilities include named ChatGPT conversation scopes,
turn lifecycle observation, versioned extension reload, `LIVE` plus conservative
`WORKING / SETTLING / QUIESCENT` state, source-chat navigation, task/run budget
presentation and provenance-labeled usage telemetry where evidence exists.

Platform-managed ChatGPT Web -> MCP/RDC calls still do not provide authoritative
end-to-end transport identity, so browser-derived attribution and quiescence are
explicitly labeled as observed/inferred rather than authoritative.

## Chrome local quickstart

The canonical Chrome installation/start/update guide is:

**[`docs/CHROME-LOCAL-INSTALL.md`](docs/CHROME-LOCAL-INSTALL.md)**

Minimal path:

```sh
git clone https://github.com/dzzk-r/execution-delivery-harness.git
cd execution-delivery-harness
npm ci
npm start
```

Then open `chrome://extensions`, enable Developer mode, choose **Load unpacked**,
and select the repository's `chrome/` directory. Pair the profile with the local
companion using the token created at:

```text
~/.config/dzzk-jso-bridge/pairing-token
```

The default companion endpoint is `http://127.0.0.1:43119`. Clicking the extension
toolbar action opens the Side Panel Observer.

`llama.cpp`, Ollama, OpenCode and a standalone `run-observer.py` process are **not
required** for this basic Chrome Side Panel path.

## Firefox development path

Firefox remains a separate adapter. Load `firefox/manifest.json` through
`about:debugging` -> **This Firefox** -> **Load Temporary Add-on** for local
synthetic/development testing. Temporary installation ends when Firefox restarts.
A permanent public install requires Mozilla signing/review.

The historical Firefox 0.1.1 validation snapshot is preserved in
[`docs/VALIDATION.md`](docs/VALIDATION.md); it is not the current Chrome install
guide.

## MCP clients and transports

Installing the browser extension alone does not establish a remote ChatGPT MCP
transport. The companion hosts local MCP/OAuth surfaces, while Web/Desktop/API
clients have different reachability and authorization paths.

See [`docs/CLIENTS-AND-TRANSPORTS.md`](docs/CLIENTS-AND-TRANSPORTS.md) before
configuring ChatGPT Web/Desktop, Responses API or another MCP host.

Browser-read tools currently include:

- `list_tabs`;
- `read_page`;
- `find_in_page`;
- `bridge_status`.

Local-executor tools are separately authorized and default to Block for a newly
authorized client.

## Security and data boundary

Page sharing is explicit and temporary. Navigation, reload, tab close, extension
restart or manual revoke ends a page grant. Unshared tabs are not exposed through
the read-only browser contract. Browser-read permission does not imply local
filesystem/process permission.

The pairing token and OAuth/client state are machine-local secrets and must not be
committed, pasted into issues or placed in screenshots.

See:

- [`docs/SECURITY-BOUNDARY.md`](docs/SECURITY-BOUNDARY.md)
- [`docs/PRIVACY.md`](docs/PRIVACY.md)
- [`docs/CONTROL-MODEL.md`](docs/CONTROL-MODEL.md)

## Development

```sh
npm test
npm run lint
npm run build
FIREFOX_BIN=/path/to/firefox npm run test:firefox
npm run project:readiness
```

`npm run build` creates an unsigned Firefox/web-ext artifact under `dist/` using
the current package version. An unsigned ZIP is not an approved AMO release.

## Architecture and operations

- [`docs/CHROME-LOCAL-INSTALL.md`](docs/CHROME-LOCAL-INSTALL.md) — canonical Chrome local install/start/update guide.
- [`docs/STATUS.md`](docs/STATUS.md) — current status and test baseline.
- [`docs/OBSERVER-ARCHITECTURE.md`](docs/OBSERVER-ARCHITECTURE.md) — event/projection architecture.
- [`docs/SIDE-PANEL-INFORMATION-ARCHITECTURE.md`](docs/SIDE-PANEL-INFORMATION-ARCHITECTURE.md) — Side Panel UX semantics.
- [`docs/EXECUTION-LIFECYCLES.md`](docs/EXECUTION-LIFECYCLES.md) — macro/micro lifecycle model.
- [`docs/LOCAL-CONTROL-OBSERVATION-PLANE.md`](docs/LOCAL-CONTROL-OBSERVATION-PLANE.md) — loopback companion contract.
- [`docs/LOCAL-STACK-ONBOARDING-DRAFT.md`](docs/LOCAL-STACK-ONBOARDING-DRAFT.md) — broader clean-machine/portable-stack inventory.
- [`docs/CLIENTS-AND-TRANSPORTS.md`](docs/CLIENTS-AND-TRANSPORTS.md) — transport-neutral client boundary.
- [`docs/PRE-1.0-RELEASE-MILESTONE-MODEL.md`](docs/PRE-1.0-RELEASE-MILESTONE-MODEL.md) — minor-version capability model.
- [`docs/EXECUTOR-COMPARISON.md`](docs/EXECUTOR-COMPARISON.md) — executor policy, RDC handoff and EDH-vs-RDC comparison contract.
- [`TODO.md`](TODO.md) — authoritative cross-cutting engineering task catalog.

## Knowledge and readiness

Durable engineering knowledge is model-independent: `knowledge/events.jsonl`
stores append-only chronology and `knowledge/records/*.json` stores curated
claims/decisions/constraints/evidence. Planner runs persist the exact retrieved
knowledge/context used for a decision.

```sh
npm run knowledge:query -- "ChatGPT Desktop stdio plugin"
npm run knowledge:context -- "CT-03 Chrome local MCP"
npm run project:readiness
```

Readiness is gate-based rather than inferred from the patch number or an average
percentage. `project/readiness.json` currently defines `owner-local-v0`,
`portable-private-v0` and `public-distribution-v1`.

MIT license. Support: GitHub issues. Do not post private browser data or tokens.
