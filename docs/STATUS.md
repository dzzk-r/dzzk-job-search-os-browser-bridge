# Browser Bridge status

## Current stage

This repository currently has two layers:

1. **Read-only Browser Bridge** — the original page-sharing/MCP bridge.
2. **Browser Bridge Observer** — the operator/observability layer developed on top
   of the same local companion.

The read-only bridge is the stable baseline. The observer is usable locally but
is still under active development and is not yet an authoritative source of
ChatGPT turn state.

## Verified locally

- Firefox read-only bridge synthetic smoke
- Chrome unpacked extension with Side Panel
- Firefox observer page
- loopback companion pairing for Firefox and Chrome
- Observer timeline from MCP history, terminal markers, OpenCode/Qwen, llama.cpp
  and Git
- process lifecycle reconstruction for tracked child PIDs
- local OpenCode 1.14.48 and 1.18.34 compatibility smoke
- active-actor UI and Open / Waiting view

## Known limitations

- The observer cannot yet see an MCP call before Desktop Commander returns it to
  history. Therefore it cannot authoritatively answer whether the current
  ChatGPT turn is still executing.
- ChatGPT's composer may appear ready while a background MCP/local execution
  chain is still running.
- A new user message may interrupt an unfinished tool turn.
- PAUSE / BREAK / STOP ALL for the observer execution plane are designed but not
  yet implemented.
- Firefox Sidebar and Opera observer adapters are not yet verified.
- Live LinkedIn DOM and live ChatGPT OAuth linking remain outside the currently
  verified scope.
- AMO signing/publication is not complete.

## Source-of-truth warning

Local development may be ahead of GitHub. Before relying on the repository state,
compare the current worktree with `origin/main` and check for uncommitted files.

As of 2026-10-03, the locally running observer/Chrome work is ahead of
`origin/main` and still needs a reviewed commit/push.

## Important paths

- Companion: `server/index.mjs`
- Firefox extension: `firefox/`
- Chrome extension: `chrome/`
- Observer engine/TUI: `scripts/run-observer.py`
- Local bounded agent: `scripts/local-agent.py`
- Observer architecture: `docs/OBSERVER-ARCHITECTURE.md`
- Pairing token: `~/.config/dzzk-jso-bridge/pairing-token`
