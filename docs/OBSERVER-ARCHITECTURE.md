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

## Causal chain and correlation model

Flat timeline events are diagnostic evidence, not a full causal trace. A flat
event stream can show what happened but cannot by itself prove which client,
turn, run, span, tool and acceptance result are connected. The observer must
therefore render a causal chain on top of the flat evidence:

```text
source client -> chat / tab / turn -> orchestrator
    -> Harness gateway / span -> executor
    -> model / runtime -> tool / artifact
    -> acceptance result
```

The gateway (GW-01) owns pre-dispatch correlation IDs. The observer consumes and
renders those IDs; it does not invent or reassign them.

The operator UI should group and filter events by source client, conversation or
session, tab, **specific turn/message/step**, and run. Provenance should preserve
the most specific locator the source adapter can supply. For ChatGPT this means
conversation plus turn/message when technically available; for local OpenCode /
Qwen execution it means session, message/step and model-request evidence. A
conversation-level link is not a substitute for a turn-level locator when the
source exposes one. Navigation back to the originating source is allowed only
when that adapter provides a safe usable locator.

Generic MCP history does not prove which MCP host produced an event. The UI must
not label an unattributed MCP event as Remote Desktop Commander, ChatGPT, or any
other client without source evidence carried by the gateway/span.

Events observed outside the Harness pre-dispatch boundary are **observed but
unscoped**. In particular, ChatGPT Web calls made directly through Remote Desktop
Commander currently arrive from completed RDC history without authoritative
conversation/turn/message identity. The Observer must not assign those events a
correlation ID by timestamp proximity or other heuristics. They remain external
evidence until the client/tool dispatch enters GW-01 before execution.

Execution evidence is untrusted input to the Observer. A malformed OpenCode event,
truncated tool-call argument, unknown field type or corrupt diagnostic row may be
rendered as degraded/invalid evidence, but must not make the whole observer
snapshot unavailable. Observer parsing therefore fails open at event granularity.
A failed snapshot is DEGRADED; OFFLINE is reserved for actual companion/transport
unavailability or authentication failure.

Failure reporting must use a structured record with at least stage, actor, code,
message and cause, correlated to a run and span. An overall FAILED status is only
a summary. Distinct failure classes that must remain distinguishable:

- gateway failure
- executor failure
- model failure
- runtime failure
- tool failure
- budget / policy failure
- acceptance failure

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

`task.txt` is the bounded task envelope, not necessarily the exact model request.
The exact OpenCode-to-model request, system context and tool schemas require
separate provenance capture when available.

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

### Progress, waiting and interruption safety

`RUNNING` or `WAITING` alone is not enough operator truth. A live run should
publish a compact checkpoint containing at least:

```text
plan / acceptance checklist
current phase
completed work
current work
pending work
budget used / remaining
waiting reason
safe_to_interrupt: yes | no | after_checkpoint
last durable checkpoint / artifact
```

A percentage is valid only when there is a meaningful denominator. Agent turns,
token count and wall-clock time are budgets, not task-completion percentages.
If progress cannot be quantified, render checklist/phase progress instead of a
fabricated percentage.

A user message must not be the implicit cancellation mechanism for long local
work. Once dispatched as durable Harness work, the run must own its process and
persist enough plan/checkpoint/artifact state to survive the originating UI turn.
The source client may detach, continue another work vector, or explicitly request
pause/stop; interruption semantics must be explicit rather than accidental.

### Semantic compaction and raw evidence

The default operator timeline is a semantic projection, not a dump of every
polling call. Repeated `read_process_output`, sleep/grep probes and duplicated
MCP/TERM lifecycle observations should collapse into one span with state changes,
progress and elapsed time. Raw events remain available as drill-down evidence.

Do **not** represent this compaction as an opaque standalone `×N` cell or badge in
the raw three-column timeline. That experiment hid event meaning and distorted the
row layout. Compaction must be semantic and named: for example, `polling for 42s`,
`3 identical permission failures`, or one lifecycle span whose state/elapsed time
changes in place. If the UI cannot explain what was grouped, it must show the raw
events instead. The raw Unified Timeline is therefore literal evidence; semantic
grouping belongs in the operator-facing trace/span projection or an explicit
expandable summary.

The same rule applies to architect escalation: local execution should produce a
small semantic checkpoint/report for ChatGPT. The architect should not need to
consume the full raw event log on every run; raw log retrieval is reserved for
failure diagnosis, disputed provenance or explicit inspection.

### Conversation-root projections

The observer keeps one append-only global event ledger. It must not split the
source-of-truth into one physical log per chat merely for UI convenience. Instead,
operator views are projections over an explicit conversation/chat root.

When authoritative or transport-observed source identity is available, the default
projection should be the current conversation. Operators may switch to other known
conversations, `Unscoped`, or `All activity`. An event without trustworthy
conversation identity must remain `Unscoped`; the observer must not assign it to
the currently focused browser tab or infer ownership from timestamp proximity.

Conversation provenance should carry a stable client/conversation identity plus a
safe source locator when the transport really provides one. A source-chat locator
is navigation metadata, not authority by itself. Opening a source conversation is
always an explicit user action. Prefer opening in a new tab; focusing/reusing an
existing tab may be offered separately. Never auto-navigate the active work tab.
Only allow navigation to trusted, validated client origins; arbitrary event text
must never become an executable/clickable URL.

GW-01 owns the prerequisite: allocate/propagate conversation/turn/action identity
before external tool dispatch. Until that boundary is authoritative, multi-chat
projection may expose `Unscoped` activity but must not manufacture a chat root.

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

## 2026-10-06 implemented conversation / process attribution layer

The Chrome adapter now has a concrete non-authoritative bridge for ChatGPT Web while the full transport boundary remains unavailable:

1. A ChatGPT tab contributes the real conversation root from its URL `/c/<conversation_id>`.
2. The browser adapter may observe a turn lifecycle (`TURN_START`, `TURN_ACTIVE`, `TURN_DONE`) without reading message text.
3. A short active-turn lease may assign otherwise-unscoped MCP/TERM evidence only when exactly one browser-observed turn is a valid owner. Such attribution is labeled `browser_inferred`.
4. Once a scoped `start_process` returns a PID, downstream process evidence is propagated by **PID + process-start timestamp**, not by continuing to infer from browser state.
5. If no turn or more than one turn plausibly owns an event, it remains `Unscoped`.

This is intentionally a narrow bridge for the first causal edge:

```text
conversation URL -> browser turn -> first tool/span -> PID/process descendants
```

It does not make browser focus authoritative, and it does not convert generic RDC/MCP history into transport-observed ChatGPT identity. The target remains a pre-dispatch client/tool boundary that carries conversation/turn identity before execution.

### Extension version / reload contract

Development reload is version-visible rather than implicit. Package, Chrome and Firefox manifests share one semantic version (current development baseline `0.1.45`). The Side Panel compares the loaded extension version with the manifest version on disk; when they differ it shows an explicit `Reload <loaded> → <disk>` control. Gateway restart must not reload the extension. File-change revision is only a signal that a newer build exists; the loaded runtime changes only after explicit user action.


### Gateway runtime / repository identity

The observer also distinguishes the gateway process actually running from the repository currently on disk. At gateway startup it records the current Git commit and SHA-256 of server/index.mjs. The observer endpoint compares those values with current repo HEAD and the current file hash. A mismatch is shown in the Side Panel as Gateway restart <runtime> → <head>. This catches both committed repository movement and uncommitted server-file changes without automatically restarting the gateway.


### Browser-turn lease recovery

A visible ChatGPT generation must not lose chat attribution merely because the gateway or extension runtime restarted. The detector therefore recreates a local turn when generation is visible but no local active turn exists. The gateway accepts a HEARTBEAT as recovery for an otherwise-valid browser turn whose in-memory state was lost, and enforces at most one active turn per conversation by replacing stale siblings. Unknown DONE is idempotent.


### Persistent timeline scope control

The Unified timeline scope selector is a persistent DOM island. The 1.5-second observer refresh computes a stable fingerprint of available scope options and leaves the existing select element and its options untouched when the model has not changed. When conversations do change, options are reconciled in place and the current timelineScope value is preserved. Polling therefore no longer destroys/recreates the native selector on every refresh.


### Browser turn completion detector (turn-v4)

The browser turn detector treats disappearance of a Stop/Cancel control as insufficient evidence of completion. Modern ChatGPT can temporarily remove generation controls while the same assistant turn is waiting on reasoning or tool activity.

turn-v4 therefore uses completed-response action controls as structural completion evidence. At turn start it records a response-action baseline. TURN_DONE is emitted only after a new completed-response action set appears, the composer is ready for the next user turn, no generation control is present, and that condition remains stable for the quiet window. If completion evidence is unavailable, the detector remains conservative and keeps the turn open until an explicit superseding submit, navigation, pagehide or maximum observation window.

Detector diagnostics expose response-action count/baseline, completion evidence, composer readiness and completion-candidate age without reading assistant message text.


### Actor/provider vs transport provenance

Observer actor identity and transport identity are separate dimensions. Remote Desktop Commander history is recorded as provider `RDC` with `transport=mcp`, rather than being mislabeled as a generic MCP actor. The `MCP` chip means recent activity over an MCP transport from providers instrumented by the Harness; it does not claim visibility into every MCP/plugin call inside ChatGPT. `RDC` means recent activity specifically from the Remote Desktop Commander provider. One RDC call can truthfully activate both chips for different reasons. A future GitHub, Gmail, or other instrumented MCP provider may activate MCP without activating RDC.


### Browser turn activity states (turn-v5)

The existence of an open browser turn is not itself evidence that ChatGPT is actively executing. The browser detector exposes four states: `active` when there is positive generation or recent assistant-DOM activity evidence; `waiting_user` when the open turn is blocked by a structurally observed modal/approval gate; `pending` when the turn remains open but no positive activity evidence is currently visible; and `idle` when no turn is open. Side Panel actor styling must render these states distinctly and must not infer `active` from `active_turn_id != null`. Approval detection is structural (`dialog`/`alertdialog` plus interactive controls) and does not inspect message text.


Gateway rule: an open browser-turn lease proves only that the turn has not been closed. It MUST NOT be converted into `CHAT active`. The observer preserves detector `activity_state`; when a lease exists but no fresh detector state is available, the conservative fallback is `pending`, never `active`.
