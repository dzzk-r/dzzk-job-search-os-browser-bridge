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

## Current debt / next cycle

- Target flow is ChatGPT supervision plus Harness -> OpenCode -> local
  model/runtime for routine bounded work; RDC is only fallback. This ChatGPT
  Web chat still has no direct Harness MCP path.
- Timeline is flat diagnostic history, not causal execution trace; no
  grouping/navigation by source client/conversation/session/tab/specific
  turn/message/step/run. Generic `MCP` history cannot currently be attributed to
  Remote Desktop Commander or another host without extra source evidence.
- A first durable task lifecycle now exists: JSON snapshot (`checkpoint.json`) +
  append-only `lifecycle.jsonl` transitions, with plan/task IDs, phase,
  completed/current/pending work, budget, waiting reason, durable checkpoint and
  `safe_to_interrupt`. Observer payload and Chrome Side Panel have a first
  Current task projection, pending Chrome Reload/live acceptance. Long worker
  execution is still not fully detached from the originating chat turn.
- Polling and observer self-noise (`read_process_output`, sleep/grep probes,
  duplicated MCP/TERM events) dominate the default timeline. The target is a
  semantic compact view with raw evidence only on drill-down, and a compact local
  checkpoint for ChatGPT so routine runs do not require shipping full logs into
  the architect context.
- Help UI has real defects: missing help-toggle wiring, duplicate runtime-grid
  id, and layout/nowrap debt.
- Run files exist, but UI artifact-content inspection is incomplete and the
  exact OpenCode-to-model serialized request is not captured.
- Failure UI needs structured stage/actor/code/message/cause instead of only
  overall FAILED.
- 4-step default is wrapper policy, not model limit; a 6-step run also
  exhausted, so budget design needs revision.
- OpenCode reaches Harness OAuth after DCR compatibility repair, but latest
  status still reports needs authentication.
- The current `chore/local-execution` checkpoint passes npm test 35/35; this does not imply review or integration into `main`.
- Qwen/OpenCode/llama.cpp is one owner profile, not a universal user stack.
- Local planning now has a first executable slice: `scripts/local-planner.mjs`
  accepts goal/evidence plus Harness-owned boundaries, calls local Qwen once, and
  emits a schema-valid bounded `task.json`. A live Help-planning run completed as
  `task_ready` in about 53 seconds. Model-authored acceptance is declarative
  evidence only; Harness owns executable verification. A first
  `run-task-envelope.mjs` worker adapter now exists but has not yet live-run the
  Help task; verification/escalation is still incomplete.
- Current automated suite is 35/35 passing after lifecycle + planner-contract tests.

Next-cycle order: planner -> validated-envelope worker adapter -> Harness-owned
verification/escalation -> execute the bounded Help/layout task through that path
-> artifact/prompt provenance -> component failure locus -> causal
correlation/navigation -> direct Harness local-tool path -> portable profiles.

## Source-of-truth warning

Local development may be ahead of GitHub. Before relying on the repository state,
compare the current worktree with `origin/main` and check for uncommitted files.

As of 2026-10-04, `chore/local-execution` is the execution/checkpoint branch and
may be ahead of `main`. Always inspect its HEAD and worktree status separately;
no checkpoint on this branch implies approval to merge into `main`.

## Important paths

- Companion: `server/index.mjs`
- Firefox extension: `firefox/`
- Chrome extension: `chrome/`
- Observer engine/TUI: `scripts/run-observer.py`
- Local bounded agent: `scripts/local-agent.py`
- Local planner: `scripts/local-planner.mjs`
- Planning contract: `docs/LOCAL-PLANNING.md`
- Planning schemas: `schemas/`
- Observer architecture: `docs/OBSERVER-ARCHITECTURE.md`
- Pairing token: `~/.config/dzzk-jso-bridge/pairing-token`
