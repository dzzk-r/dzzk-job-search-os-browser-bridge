# Execution Delivery Harness - ToDo

This is the cross-cutting execution plan for the repository. It tracks the work
that cuts across Browser Bridge, MCP transport, Local Executor, Observer,
client integrations and release/distribution.

## Legend

- **🟩 G** - understood path / low design risk.
- **🟨 Y** - feasible, but still needs integration or platform validation.
- **🟥 R** - unresolved blocker, external dependency or decision risk.
- **XS** - <= 2 h.
- **S** - 2-4 h.
- **M** - 4-8 h.
- **L** - 1-2 engineering days.
- **XL** - 3-5 engineering days.
- **%** - current readiness, including implemented code, tests, research,
  specification and completed spikes. It is not just lines of code.
- **ETA** - approximate remaining engineering effort, not a calendar promise and
  not external review/wait time.
- The G/Y/R cell uses a solid color block as well as the letter so the status is
  scannable without relying on color alone. GitHub-flavored Markdown does not
  provide portable whole-cell background styling.

### Task ID prefixes

The prefix is a stable workstream/category label. It is **not** a priority,
status or dependency indicator.

| Prefix | Workstream | Scope |
| --- | --- | --- |
| **REP** | Repository / provenance | Canonical repo, branches, worktrees, Git provenance and integration hygiene |
| **BRW** | Browser Bridge core | Browser-neutral explicit page grants and read-only browser/MCP contract |
| **CHR** | Chrome | Chrome-specific extension, Side Panel and adapter behavior |
| **FFX** | Firefox | Firefox-specific extension, sidebar/operator surface and packaging behavior |
| **OPR** | Opera | Opera/Chromium-specific compatibility and adapter work |
| **LOC** | Local Executor | Filesystem, terminal and process-control MCP tools on the owner's machine |
| **SEC** | Security / isolation | Execution boundaries, sandboxing, path/policy enforcement and privilege reduction |
| **OBS** | Observer | Actors, timeline, lifecycle reconstruction and operator UI/event rendering |
| **GW** | Gateway | Pre-dispatch MCP gateway, authoritative spans, leases, heartbeat and correlation |
| **CT** | Clients / transports | ChatGPT Web/Desktop, OpenAI API and generic MCP client transport compatibility |
| **LLM** | Local model execution | OpenCode/Qwen/llama.cpp local-first work and bounded escalation to remote models |
| **PL** | Local planning / orchestration | Intent decomposition, bounded task envelopes, local verification and compact escalation packets |
| **REL** | Release / external integration | Live account/tool discovery, browser-store release and public plugin/distribution tracks |

Example: `CT-03` means the third tracked task in the **Clients / transports**
workstream. The number does not imply that `CT-01` must finish before
`CT-03` unless a dependency is stated in the task itself.

Snapshot: 2026-10-04, branch `chore/local-execution`.

## Cross-cutting plan

| ID | Task | G/Y/R | Size | % | ETA | Current evidence / next sufficiency condition |
| --- | --- | :---: | :---: | ---: | ---: | --- |
| REP-01 | Canonical repo/worktree provenance and branch hygiene | 🟩 **G** | S | 90% | 1-2 h | Broken worktree pointer repaired; `chore/local-execution` committed and pushed to `dzzk-r/execution-delivery-harness`. Remaining: reviewed integration into `main`, without overwriting newer canonical changes. |
| BRW-01 | Explicit page-grant Browser Bridge baseline | 🟩 **G** | S | 90% | 1-2 h | Opaque 30-minute grants, navigation/reload/close/revoke invalidation and URL checks are tested. Remaining: live Facebook/other signed-in page end-to-end read through the final MCP client path. |
| CHR-01 | Chrome Side Panel Observer + safe share controls | 🟨 **Y** | S | 95% | <1 h | Help now uses one `#help-toggle`, duplicate `runtime-grid` IDs are removed, runtime/help grids are distinct, and a focused regression test covers the wiring. The terminal child-run error no longer controls the whole Observer header. Remaining: Chrome Reload + visual acceptance of Help, `Current task`, and layout/nowrap. |
| FFX-01 | Firefox Browser Bridge + Observer adapter | 🟩 **G** | M | 70% | 2-4 h | Read-only bridge synthetic smoke and observer page exist. Remaining: verify intended sidebar/operator surface against current shared observer contract. |
| OPR-01 | Opera/Chromium Observer adapter | 🟨 **Y** | M | 10% | 4-8 h | Architecture expects a Chromium-family adapter; compatibility has not been verified. |
| LOC-01 | Local Executor MCP namespace for filesystem + terminal + process control | 🟨 **Y** | M | 70% | 4-8 h | `local_status/list_dir/read_file/write_file/exec_start/process_output/process_stop` implemented and tested; local methods default Block. Remaining: live MCP-host use and hardening around trusted shell. |
| LOC-02 | Remove Remote Desktop Commander from the filesystem/terminal/process critical path | 🟥 **R** | L | 55% | 1-2 d | Incomplete. This ChatGPT Web chat still lacks direct Harness MCP, so routine repo/terminal work still used RDC. Local primitives exist but are not the routine client path. Remaining: route routine work through Harness local tools without RDC, keep it only as bootstrap/GUI/emergency fallback. |
| SEC-01 | Local execution isolation beyond trusted-shell `cwd` | 🟨 **Y** | M | 30% | 4-8 h | Filesystem methods enforce roots/realpath/symlink rules and optimistic writes; `local_exec_start` is explicitly still trusted shell. Sufficiency: enforce a real execution policy/sandbox or a deliberately narrower command contract. |
| OBS-01 | Browser-neutral actor registry and lifecycle rendering | 🟩 **G** | M | 85% | 1-2 h | Actor registry, TUI/Side Panel, spans, timeline and run-inspection projection now exist. Remaining: validate the shared contract on the next live run and then across Firefox/Opera adapters. |
| OBS-02 | Actor activity truth: registry vs live activity and local-agent event visibility | 🟩 **G** | S | 100% | 0 h | Live 2026-10-04 run visibly showed OC -> QWEN -> LLAMA activity with corresponding timeline events, then returned actors to idle. TERM no longer treats a merely alive shell as active; Git Δn is state, not activity. |
| OBS-03 | Run provenance, failure reason and artifact/log inspection | 🟨 **Y** | S | 75% | 2-4 h | Run bundle (task/config/command/events/report) exists, but the UI mostly shows summary and paths; artifact content inspection is incomplete. Failure reporting is coarse (no structured stage/actor/code/message/cause). Remaining: inspect artifact contents in UI, add structured failure locus, then reload/UI acceptance. |
| OBS-04 | Causal provenance/correlation UI with turn-level source navigation | 🟨 **Y** | M | 18% | 4-8 h | Consume GW-01 correlation rather than inventing another source of truth. Required source identity is client + conversation/session + specific turn/message/step when the adapter exposes one. ChatGPT should navigate to the originating conversation and, where technically possible, the exact turn; local OpenCode/Qwen provenance should resolve to the exact session/message/step/model-request evidence. The current panel cannot attribute generic `MCP` history to Remote Desktop Commander, so `MCP` must not be rendered as `RDC` without source proof. |
| OBS-05 | Structured failure locus, scope and component-local diagnostics | 🟨 **Y** | S | 18% | 2-4 h | Add stage/actor/code/message/cause plus failure scope (`event/span/run/cycle/system`). A child process or model/runtime failure must annotate the failing component/span and must not paint the whole Side Panel ERROR unless the enclosing run/cycle actually failed. |
| OBS-06 | Run plan, progress, waiting reason and remaining-work contract | 🟨 **Y** | M | 45% | 2-4 h | `checkpoint.json` carries plan/task identity, phase, completed/current/pending work, budget, waiting reason, durable checkpoint and `safe_to_interrupt`; `lifecycle.jsonl` records append-only START/PROGRESS/WAITING/DONE/ERROR transitions. Observer payload and Chrome Side Panel have a Current task projection, terminal child-run failure now leaves top-level activity IDLE, and missing lifecycle data renders explicitly as `NO DATA` instead of disappearing. Remaining: Reload/live acceptance and wire Harness-owned verification progress into the same lifecycle. |
| OBS-07 | Semantic timeline and observer self-noise compaction | 🟨 **Y** | M | 10% | 4-8 h | The default timeline currently floods the operator with polling (`read_process_output`, sleep/grep probes) and duplicated MCP/TERM lifecycle lines. Collapse these into semantic spans/state transitions by default; keep raw events as drill-down evidence. |
| GW-01 | Pre-dispatch MCP gateway with authoritative spans/lease/heartbeat/source identity | 🟨 **Y** | L | 28% | 1-2 d | Architecture is specified; current completed-history reconstruction cannot prove an in-flight ChatGPT/MCP turn. START must allocate correlation/run IDs and capture the best available source locator before dispatch; terminal DONE/ERROR/TIMEOUT/CANCELED must close the same span. |
| GW-02 | Durable detached runs, handoff and interruption-safe parallel work | 🟨 **Y** | L | 10% | 1-2 d | Long local work is currently coupled to the active chat/tool turn, so the user may wait rather than risk interrupting it. A dispatched run must become durable Harness-owned work with persisted plan/checkpoint/artifacts and explicit stop ownership, so a new chat message or adjacent work vector cannot silently destroy it. |
| CT-01 | Freeze client/transport boundary: Web / Desktop / API / generic MCP | 🟩 **G** | XS | 100% | 0 h | `docs/CLIENTS-AND-TRANSPORTS.md` records the transport-neutral harness boundary, client matrix and validation order; README and Observer architecture link to it. |
| CT-02 | ChatGPT Web -> Harness live MCP path | 🟨 **Y** | M | 20% | 4-8 h | Official remote/Secure MCP Tunnel paths identified; repository has local MCP/OAuth pieces. Remaining: establish supported transport, tool discovery, auth and browser/local read acceptance sequence. |
| CT-03 | ChatGPT Desktop -> Harness local MCP/plugin path | 🟨 **Y** | M | 10% | 4-8 h | Product path documented; no repository packaging/live verification yet. Sufficiency: same tool contract available in Desktop without changing Browser Bridge/Local Executor semantics. |
| CT-04 | Responses API -> Harness MCP path | 🟨 **Y** | S | 10% | 2-4 h | Official `server_url` / `tunnel_id` path documented; no live API acceptance run yet. |
| CT-05 | Generic MCP host compatibility | 🟨 **Y** | M | 35% | 4-8 h | OpenCode 1.14.48 now discovers Harness MCP and reaches OAuth after the DCR compatibility repair, but the latest `mcp list` still reports needs authentication. Partial compatibility evidence, not end-to-end acceptance. Sufficiency: at least one non-OpenAI MCP host discovers and calls the same tools without a host-specific fork. |
| CT-06 | Portable execution profiles / onboarding | 🟨 **Y** | M | 10% | 4-8 h | Qwen/OpenCode/llama.cpp is the owner's current execution profile, not a universal stack. Future users may bring different executors, models and runtimes. Explicit client/tool permission consent remains a user action and must not be bypassed by onboarding. Remaining: define a portable profile/onboarding contract that does not assume the owner's stack. |
| LLM-01 | Local-first OpenCode/Qwen execution with bounded escalation | 🟨 **Y** | M | 78% | 2-4 h | The 4-step ceiling was a wrapper default, not a model/runtime limit. A live planner→worker CHR-01 run through OpenCode 1.14.48/Qwen3.8-27B/llama.cpp reached `max_steps` after making useful edits; semantic acceptance correctly reported failure while preserving artifacts/lifecycle state. Current automated suite is 36/36. Remaining: replace fixed step-count as the dominant work budget and complete Harness-owned verification/escalation. |
| LLM-02 | Capture exact serialized model request from OpenCode to runtime | 🟨 **Y** | S | 10% | 2-4 h | `task.txt` is not the full prompt; the exact serialized request OpenCode sends to the model/runtime must be captured. Remaining: capture and store the full serialized request for inspection. |
| LLM-03 | Observable architect-vs-worker routing | 🟨 **Y** | M | 10% | 4-8 h | Make architect-vs-worker routing observable. Target roughly 90% routine bounded work local and 10% ChatGPT supervision/escalation. Remaining: surface routing decisions in the observer and validate the split on live runs. |
| PL-01 | Local planner contract: task envelope + escalation packet | 🟩 **G** | S | 65% | 1-2 h | `docs/LOCAL-PLANNING.md`, machine-readable task/escalation schemas, reusable validator and contract tests define the boundary. Live planning exposed and fixed an unsafe design where model-authored acceptance could have become executable shell; acceptance is now declarative evidence only. Remaining: add the corresponding Harness-owned verifier contract and persist plan/checkpoint state. |
| PL-02 | Local intent decomposition into bounded worker tasks | 🟨 **Y** | M | 60% | 2-4 h | `scripts/local-planner.mjs` emits a validated bounded task and publishes durable lifecycle state. `scripts/run-task-envelope.mjs` preserves Harness-owned scope/profile/budget and has now live-run the Help envelope through OpenCode/Qwen without a ChatGPT-authored worker prompt. Remaining: tighten policy-derived request fields and connect successful worker output to Harness-owned verification/repair/escalation. |
| PL-03 | Local verification, repair decision and compact architect escalation | 🟨 **Y** | M | 10% | 4-8 h | Verification/escalation contract is specified. Remaining: consume worker report + acceptance evidence, choose done/one bounded repair/escalate, and emit a compact escalation packet instead of shipping raw logs to ChatGPT. |
| REL-01 | Live ChatGPT OAuth/tool-discovery validation | 🟨 **Y** | M | 25% | 4-8 h | OAuth/PKCE behavior is covered synthetically; live account linking/tool discovery is explicitly unverified. |
| REL-02 | AMO signing/publication and signed Firefox install | 🟨 **Y** | L | 45% | 1-2 d | Listing/privacy/validation material and unsigned package path exist. Remaining includes account submission, review/signing and signed-XPI smoke; external review latency is excluded from ETA. |
| REL-03 | Public ChatGPT plugin/distribution path | 🟥 **R** | XL | 10% | 3-5 d | Private/developer connectivity is not public distribution. Public submission requires a stable publicly reachable HTTPS MCP endpoint and separate review/distribution work. Do not conflate Secure MCP Tunnel with this task. |

## Current delivery gates

**Green gate - local user-owned loop:** passing this gate requires at least one
routine operation from a real client to reach the Harness Local Executor
filesystem/terminal/process tools through the harness without Remote Desktop
Commander, with explicit page and local-operation policy. Remote Desktop
Commander may remain an optional GUI/bootstrap/emergency fallback.

**Yellow gate - client portability:** the same MCP tool contract passes the
acceptance sequence from ChatGPT Web, ChatGPT Desktop and the Responses API
without forking Browser Bridge or Local Executor semantics.

**Red gate - distribution:** signed/public browser packages and any public
ChatGPT/plugin distribution are separately reviewed release tracks. Private
developer connectivity does not satisfy this gate.

Update this file when evidence changes. Percentages should move because a
specific sufficiency condition was met or invalidated, not because time passed.
