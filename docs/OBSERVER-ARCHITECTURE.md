# Browser Bridge Observer architecture

## Purpose

Browser Bridge Observer is the operator surface for local and browser-adjacent
execution initiated from a ChatGPT workflow. Its primary job is to prevent false
idle: the chat UI may look ready for a new user message while an MCP call, local
process, model run, or browser action is still executing.

The observer is not a second automation engine. It renders one browser-neutral
execution state that can be consumed by a terminal TUI and by browser-specific
surfaces.

## Browser-neutral execution plane

```text
ChatGPT / MCP client
        |
        v
Observer / MCP gateway
  START before dispatch
  span id / lease / heartbeat
  RUNNING or WAITING
        |
        v
MCP tool / browser bridge / local execution
        |
        +--> TERM / child processes
        +--> OpenCode
        +--> Qwen
        +--> llama.cpp
        +--> Git / filesystem
        |
        v
END / ERROR / TIMEOUT / CANCELED
        |
        v
Observer event plane
        |
        +--> Terminal TUI
        +--> Chrome Side Panel
        +--> Firefox Sidebar adapter
        +--> Opera Chromium adapter
```

The gateway and event plane are the contract. Browser APIs are adapters around
that contract, not separate observer implementations.

The upstream client is also an adapter concern rather than an Observer-specific
architecture. ChatGPT Web, ChatGPT Desktop, the OpenAI Responses API and generic
MCP hosts should reach the same harness tool/event contracts through compatible
transports. See [Clients and transports](CLIENTS-AND-TRANSPORTS.md) for that
boundary and its validation matrix.

## Why completed MCP history is not enough

Desktop Commander writes its tool-history record after a tool call returns.
Therefore a long in-flight MCP call is invisible in
`~/.claude-server-commander/tool-history.jsonl` until completion.

This means completed history can reconstruct child-process lifecycle but cannot
prove that the current ChatGPT -> MCP dispatch is idle. A future gateway must
record START before forwarding the call and close that span only when the call
returns, errors, times out, or is canceled.

Until that gateway exists, the observer must not claim that absence of a recent
history record means the ChatGPT turn is safe to interrupt.

## Lifecycle model

Flat events remain useful for diagnostics, but operator state is represented by
spans:

```text
START -> RUNNING -> WAITING -> RUNNING -> DONE
                                  |
                                  +-> ERROR
                                  +-> TIMEOUT
                                  +-> CANCELED
```

Examples of correlation already available locally:

- `start_process` -> returned PID
- `read_process_output(pid)` -> RUNNING or WAITING
- `Process completed with exit code ...` -> DONE or ERROR
- `kill_process(pid)` / `force_terminate(pid)` -> CANCELED
- local-agent `report.json` -> DONE / ERROR / TIMEOUT
- OpenCode event stream -> step/tool lifecycle
- llama.cpp `/slots` -> model BUSY / idle

The Side Panel and TUI expose an **Open / Waiting** view so a START without an END
is visible instead of silently aging in the timeline.

## Run provenance and task truth

Actor activity answers **who is doing something now**. It is not enough to answer
**what task is being attempted, under which limits, and why it failed**.

A local-agent run therefore has a durable evidence bundle:

```text
run/
  task.txt       exact bounded task / prompt
  config.json    model, permissions and execution budget
  command.json   executor argv and working directory
  events.log     OpenCode / model / tool event stream
  report.json    semantic acceptance result
```

The Observer projects this bundle as a **run inspection** view. The projection
must expose at least the task, executor and model, step/token/deadline budget,
elapsed time, process exit, semantic outcome reason, expected/changed files and
artifact paths.

This creates two deliberately separate truths:

```text
PROCESS TRUTH                       TASK TRUTH
OpenCode exit=0                     FAILED: max_steps_reached
llama.cpp returned normally         expected artifact unchanged
shell process ended                 artifact not ready for review
```

A successful process exit must never be rendered as successful task completion
unless the task's acceptance condition also passed.

The run directory is the durable provenance record. Browser UI, TUI and future
remote panels are projections of that record plus live event state; they are not
the source of truth themselves. This also gives post-mortem inspection a stable
path when a live event has already disappeared from the timeline.

### Causal chain

For delegated local implementation the intended causal chain is explicit:

```text
requesting client / orchestrator
        -> local-agent task envelope
        -> OpenCode executor
        -> selected local model (Qwen)
        -> llama.cpp runtime
        -> bounded tools / artifacts
        -> acceptance report
```

Transport used to start `local-agent` is not the executor identity. For example,
Desktop Commander may currently launch the wrapper, but the run must still
identify OpenCode as executor and Qwen/llama.cpp as model/runtime. When Local
Executor replaces Desktop Commander on the critical path, this provenance model
does not change.

### Budget exhaustion

Step, token and deadline limits are policy inputs, not generic infrastructure
errors. `max_steps_reached`, deadline, STOP, model/tool errors and acceptance
failure must remain distinguishable. A bounded agent may return process exit 0
after reaching its step policy; the semantic run result is still failed until
the expected artifact passes acceptance.

## Turn safety

The eventual gateway exposes a turn-level state independent of ChatGPT's visual
composer state:

```text
CHAT TURN
● BUSY       one or more gateway spans are open
○ IDLE       no gateway spans are open
! STALLED    an open span exceeded its heartbeat/deadline policy
```

A new user message should be treated as potentially interrupting while BUSY or
STALLED. The browser UI's apparent readiness is not authoritative.

## Controls

Controls have intentionally different semantics:

- **PAUSE**: do not start new observer/gateway operations; let the current span
  finish.
- **BREAK**: interrupt the selected managed span when the adapter supports a
  safe cancellation path, for example a tracked PID or local-agent STOP.
- **STOP ALL**: block new dispatch and stop known managed child execution.
  Destructive or non-reversible operations require confirmation.

These controls must not pretend to cancel work the adapter cannot actually
cancel.

## Actor registry

The original `MCP | TERM | OC | QWEN | LLAMA | GIT` list was a bootstrap set,
not a permanent protocol.

Built-in actors remain defaults, while
`~/.config/dzzk-jso-bridge/observer-actors.json` can rename, hide, or add
actors. A custom actor can point at an append-only JSONL source:

```json
{
  "actors": [
    {"id":"MCP","label":"MCP","enabled":true},
    {"id":"TERM","label":"Terminal","enabled":true},
    {
      "id":"DOCKER",
      "label":"Docker",
      "enabled":true,
      "jsonl":"~/logs/docker-observer.jsonl",
      "timestamp_field":"timestamp",
      "message_field":"message"
    }
  ]
}
```

A custom JSONL source does not receive execution privileges. It contributes
observer events only.

## Browser adapters

### Chrome

Use Manifest V3 Side Panel as the normal operator surface. It reads observer
state through the extension background service worker and the paired loopback
companion. The pairing token is not exposed to the Side Panel page.

### Firefox

Use the same observer data contract through a Firefox sidebar-compatible
adapter. Firefox-specific extension APIs may differ from Chrome; the observer
data plane and lifecycle semantics must not.

### Opera

Opera is treated as a Chromium-family adapter where supported extension APIs are
available. Compatibility must be verified rather than inferred from Chrome.
Opera support does not change the gateway/event contract.

No browser adapter may require changing the semantics of START, WAITING, END,
PAUSE, BREAK, or STOP ALL.

## Security boundary

- Companion remains bound to loopback.
- Browser profiles pair explicitly with the local companion.
- Observer pages do not receive the raw pairing token.
- User-added actor sources are read-only telemetry inputs.
- Browser UI cannot silently expand page grants or MCP permissions.
- Observer controls apply only to operations for which an explicit managed
  cancellation path exists.

## Current implementation status

Implemented:

- unified timeline from MCP history, terminal markers, OpenCode/Qwen, llama.cpp,
  and Git
- fixed-screen TUI with history navigation
- Chrome Side Panel and Firefox observer page using the same companion snapshot
- active-actor indication with known/idle separated from confirmed activity
- process spans reconstructed from PID-correlated Desktop Commander history
- Open / Waiting data contract
- local-agent run provenance projection: task, executor/model, budget, semantic outcome and artifact/log paths
- configurable actor registry and custom JSONL telemetry actors

Not yet implemented:

- pre-dispatch MCP gateway / turn lease
- authoritative CHAT TURN BUSY state for in-flight Remote Desktop calls
- PAUSE / BREAK / STOP ALL gateway controls
- verified Firefox sidebar and Opera observer adapters
