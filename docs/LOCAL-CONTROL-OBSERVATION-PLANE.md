# Local Control / Observation Plane

Status: canonical local-runtime note
Date: 2026-10-07
Scope: owner-local Execution Delivery Harness companion

## Identity

`127.0.0.1:<port>` is the owner-local **control / observation plane endpoint** for Execution Delivery Harness. The default port is `43119`.

It is **not an agent** and it is not a global ChatGPT MCP runtime. It is a single-user loopback companion process that accepts Browser Bridge telemetry, exposes the Observer snapshot/control APIs, hosts the local Browser Bridge MCP endpoint, coordinates explicit browser grants/pairing, and exposes bounded local execution surfaces.

The process is started by:

```text
npm start
  -> node server/index.mjs
  -> createBridgeServer()
  -> listen(127.0.0.1:43119)
```

The port resolves in this order: an explicit `createBridgeServer({port})` option, then `EDH_COMPANION_PORT`, then the default `43119`. `npm start` uses Node's `--env-file-if-exists=.env`, so a project-local `.env` may define `EDH_COMPANION_PORT`; if neither code nor environment sets a port, `43119` is used.

## Browser configuration

Browser settings expose the **port** while keeping the scheme and host fixed to loopback HTTP:

```text
http://127.0.0.1:<configured-port>
```

The default shown in Settings is `43119`. The configured endpoint is persisted in extension storage. `validateConfig()` rejects non-loopback hosts, credentials, paths, query strings and fragments.

The browser port and `EDH_COMPANION_PORT` must match when a custom port is used. Browser host permissions and extension CSP permit loopback HTTP ports for this purpose.

## Major surfaces hosted by the companion

The companion owns or serves:

- `/bridge/...` — extension telemetry, observer state, policy/control, conversation and turn observations;
- `/mcp` — general EDH MCP surface;
- `/mcp/browser` — browser-scoped MCP surface;
- `/dev/chat-detectors` and related developer diagnostics;
- OAuth/DCR endpoints used by supported MCP clients;
- the Observer snapshot pipeline backed by `scripts/run-observer.py`.

The Side Panel Observer is a **projection/UI** over this plane. The plane is not itself the Observer, and neither one is an autonomous agent.

## Process ownership and lifetime

The normal owner-local process is:

```text
node server/index.mjs
```

It is daemon-like only in the ordinary sense that it remains listening while the user keeps it running. A live listener on the configured port proves that the companion server is alive; it does **not** prove that CHAT, MCP, RDC, TERM, OpenCode or a model is actively doing work.

Actor activity must continue to come from actor-specific evidence.

## Security boundary

The server binds to `127.0.0.1`. Pairing/authentication and explicit browser page grants remain separate controls. A public/tunneled MCP origin, when intentionally configured, is a transport into this local server rather than evidence that the local listener became public by itself.

## Operator wording

Use:

- `Local control / observation plane`
- `Local companion`
- `Browser Bridge companion`

Avoid:

- `agent` when referring to the listener itself;
- `global MCP`;
- `ChatGPT runtime`.

The Observer Help/Diagnostics surface should eventually expose the endpoint, process identity, loaded/runtime revision and configuration source without making the port number part of the primary status line.
