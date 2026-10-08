# Execution Delivery Harness - ToDo

This is the cross-cutting execution plan for the repository. It tracks the work
that cuts across Browser Bridge, MCP transport, Local Executor, Observer,
client integrations and release/distribution.

Release-version rationale: `docs/PRE-1.0-RELEASE-MILESTONE-MODEL.md` defines the pre-1.0 capability model, including the proposed `0.1.x` owner-local Observer/foundation phase, the `0.2.0` owner-local execution gate, and the later portable-private milestone.

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

Snapshot: 2026-10-08, branch `chore/local-execution`. The live-acceptance worktree remains the current development baseline. The full automated suite is 129/129 passing; bulk runtime runs remain local-only. Extension 0.1.33 source-chat navigation fix is committed and pushed at `f970efa`.

## Cross-cutting plan

| ID | Task | G/Y/R | Size | % | ETA | Current evidence / next sufficiency condition |
| --- | --- | :---: | :---: | ---: | ---: | --- |
| REP-01 | Canonical repo/worktree provenance and branch hygiene | 🟩 **G** | S | 92% | 1-2 h | The mixed live-acceptance worktree was classified and stabilized: executable code/tests, curated evidence/knowledge, and project documentation are separated; Python cache and bulk runtime `runs/` are excluded from Git while local provenance is preserved. Full suite is 129/129. Extension 0.1.33 source-chat navigation is checkpointed and pushed at `f970efa`. Remaining: perform reviewed integration into `main` without overwriting newer canonical changes. |
| BRW-01 | Explicit page-grant Browser Bridge baseline | 🟩 **G** | S | 90% | 1-2 h | Opaque 30-minute grants, navigation/reload/close/revoke invalidation and URL checks are tested. Remaining: live Facebook/other signed-in page end-to-end read through the final MCP client path. |
| CHR-01 | Chrome Side Panel Observer + safe share controls | 🟨 **Y** | S | 97% | <1 h | The Side Panel wiring is stable, `Current task` and Run grammar have been visually reviewed, transport/background rendering is normalized, attribution diagnostics are anomaly-driven, and versioned reload remains explicit. Remaining: final Help acceptance plus narrow-width/nowrap visual acceptance before closing the Chrome operator surface. |
| CHR-02 | Versioned extension reload UX | 🟩 **G** | XS | 100% | 0 h | Live accepted on 2026-10-06: loaded Side Panel 0.1.2 detected disk 0.1.5 after the current gateway exposed disk semver, rendered an explicit Reload action, reloaded only on user click, and removed the mismatch control once versions matched. The mismatch action has a dedicated Side Panel row so it remains visible in narrow layouts. Current development baseline is 0.1.33. |
| UI-01 | Side Panel information architecture and progressive disclosure | 🟨 **Y** | M | 85% | 2-4 h | Design baseline: `docs/SIDE-PANEL-INFORMATION-ARCHITECTURE.md`; canonical lifecycle model: `docs/EXECUTION-LIFECYCLES.md`. Current task is live-accepted; Run reuses the same key/value grammar; CHAT is a first-class browser context/root actor; Project readiness exposes the current selected Project identity and semantic-help labels; Execution spans and Transports/background use the compact shared grammar; Attribution diagnostics are now anomaly-driven and hidden when recent attribution is healthy. Remaining: define the true multi-project contract behind selected Project; add timeline projection controls with distinct `Semantic / Grouped / Raw` views and independent `Compact / Normal / Forensic` detail density; restore causal trace as event/span drill-down rather than a permanent top-level card; complete lifecycle/control-plane Help; and run final narrow-width acceptance. The projection controls must never mutate or delete raw ledger evidence. Dependencies/children: CHR-01, OBS-03, OBS-04, OBS-05, OBS-06, OBS-07. |
| FFX-01 | Firefox Browser Bridge + Observer adapter | 🟩 **G** | M | 70% | 2-4 h | Read-only bridge synthetic smoke and observer page exist. Remaining: verify intended sidebar/operator surface against current shared observer contract. |
| OPR-01 | Opera/Chromium Observer adapter | 🟨 **Y** | M | 10% | 4-8 h | Architecture expects a Chromium-family adapter; compatibility has not been verified. |
| LOC-01 | Local Executor MCP namespace for filesystem + terminal + process control | 🟨 **Y** | M | 70% | 4-8 h | `local_status/list_dir/read_file/write_file/exec_start/process_output/process_stop` implemented and tested; local methods default Block. Remaining: live MCP-host use and hardening around trusted shell. |
| LOC-02 | Remove Remote Desktop Commander from the filesystem/terminal/process critical path | 🟥 **R** | L | 55% | 1-2 d | Incomplete. This ChatGPT Web chat still lacks direct Harness MCP, so routine repo/terminal work still used RDC. Local primitives exist but are not the routine client path. Remaining: route routine work through Harness local tools without RDC, keep it only as bootstrap/GUI/emergency fallback. |
| SEC-01 | Local execution isolation beyond trusted-shell `cwd` | 🟨 **Y** | M | 30% | 4-8 h | Filesystem methods enforce roots/realpath/symlink rules and optimistic writes; `local_exec_start` is explicitly still trusted shell. Sufficiency: enforce a real execution policy/sandbox or a deliberately narrower command contract. |
| OBS-01 | Browser-neutral actor registry and lifecycle rendering | 🟩 **G** | M | 90% | 1-2 h | Actor registry, TUI/Side Panel, spans, timeline and run-inspection projection are live. Chrome carries browser-observed CHAT lifecycle evidence and process-instance metadata without changing the browser-neutral ledger contract, and the current Chrome actor/lifecycle projection has been visually reviewed. Remaining: final Chrome narrow-width acceptance and validation of the same event/projection contract across Firefox/Opera adapters. |
| OBS-02 | Actor activity truth: registry vs live activity and local-agent event visibility | 🟩 **G** | S | 100% | 0 h | Accepted on real OpenCode 1.14.48 / Qwen3.8 / llama.cpp worker run `OBS-02-WORKER-ACCEPT`, correlation `corr:30b0bf97-d535-4f6b-a41a-43f9df816d01`. Live activity showed TERM→OC→QWEN→LLAMA RUNNING with correct parent spans; failure-path termination closed all four ERROR on the same correlation and all actor flags returned idle. Side Panel visually showed `Last task`, `0 open`, and terminal LLAMA/QWEN/OC/TERM spans. Evidence: `evidence/obs-02-worker-live-20261005.json` and `docs/OBS-02-LIVE-ACCEPTANCE-2026-10-05.md`. |
| OBS-03 | Run provenance, failure reason and artifact/log inspection | 🟨 **Y** | S | 75% | 2-4 h | Run bundle (task/config/command/events/report) exists, but the UI mostly shows summary and paths; artifact content inspection is incomplete. Failure reporting is coarse (no structured stage/actor/code/message/cause). Remaining: inspect artifact contents in UI, add structured failure locus, then reload/UI acceptance. |
| OBS-04 | Causal provenance/correlation UI with turn-level source navigation | 🟨 **Y** | M | 97% | <1 h | Controlled CHAT→ACTION correlation exists for Harness-owned work. Chrome derives real ChatGPT conversation IDs from /c/<id>, projects named conversations, records browser-observed turn lifecycle, and propagates scoped process descendants by PID+start-time. Scoped timeline rows expose Open source chat; Unscoped rows do not. Source-chat navigation is live-accepted on extension 0.1.33: existing chats activate, current-chat no-ops are explicit, and missing tabs fall back to canonical `/c/<conversation_id>` navigation. The former always-visible recent causal tree was intentionally removed from the top-level Attribution diagnostics block because attribution health and causal inspection are different concerns. Remaining: restore trace/span hierarchy as an on-demand drill-down from semantic/grouped items to the exact raw source events, and obtain authoritative pre-dispatch identity for platform-managed ChatGPT tool calls. |
| OBS-05 | Structured failure locus, scope and component-local diagnostics | 🟨 **Y** | S | 18% | 2-4 h | Add stage/actor/code/message/cause plus failure scope (`event/span/run/cycle/system`). A child process or model/runtime failure must annotate the failing component/span and must not paint the whole Side Panel ERROR unless the enclosing run/cycle actually failed. |
| OBS-06 | Run plan, progress, waiting reason and remaining-work contract | 🟨 **Y** | M | 67% | 1-3 h | Durable lifecycle spans worker checkpoints and detached Harness ownership; PID+start-time process instances preserve scoped ancestry after the browser turn lease ends. `checkpoint.json`/`lifecycle.jsonl` and detached state expose task phase/work/budget/safety/heartbeat. The Side Panel now distinguishes Execution & ownership from Handoff & result, keeps Ready handoff dispatchable only while READY, and exposes prepared/dispatched/finished/result ages. Remaining: Harness-owned verifier progress in the same lifecycle, explicit pause/stop/resume controls, and final operator acceptance. Evidence: `evidence/gw-02-detached-run-live-20261005.json`. |
| OBS-07 | Versioned semantic timeline projection over immutable evidence | 🟨 **Y** | M | 63% | 4-8 h | Unified timeline already has one scope selector (`All activity`, `Unscoped`, named ChatGPT conversations), real conversation IDs from ChatGPT URLs, scoped-before-cap projections, rerendering when late attribution enrichment changes event identity, and live source-chat navigation. Current-chat MCP/RDC/TERM activity has been observed landing in the current chat while fresh Unscoped leakage stopped; browser-observed TURN lifecycle and PID+start-time descendant propagation remain conservative and never assign by focus alone. New hard contract: raw ledger evidence is append-only/authoritative; projection may omit from view but may never omit from evidence. Remaining: implement deterministic `Grouped` projection for MCP START→DONE/ERROR tool calls, RDC→TERM/process lifecycles, CHAT turn lifecycles and short policy/error bursts; implement `Semantic` projection with human-readable operation labels; keep `Raw` directly selectable; every derived item must carry exact `derived_from` source-event references and a versioned/reproducible projection ruleset; allow one-click descent Semantic→Grouped→Raw; preserve historical raw evidence across re-projection; and finish authoritative GW-01 entry for external calls. Evidence: `evidence/gw-01-multichat-live-20261006.json` plus 2026-10-06/08 live Side Panel acceptance. |
| GW-01 | Pre-dispatch MCP gateway with authoritative spans/lease/heartbeat/source identity | 🟨 **Y** | L | 84% | 2-5 h | Controlled pre-dispatch turn/action admission and multi-chat conflict rejection are implemented. On ChatGPT Web, Chrome now supplies real URL-derived `conversation_id`, browser-observed TURN START/ACTIVE/DONE, an active-turn lease, and conservative `browser_inferred` attribution when exactly one browser turn owns the window; process descendants inherit scope by PID+start-time. This is still not transport authority: platform-managed ChatGPT Web→RDC/MCP calls can arrive without a causal marker and remain Unscoped. Remaining primary gap: bind the real client/tool dispatch to the known chat/turn before execution, then promote source quality from browser inference to authoritative/transport-observed where possible. Evidence: `evidence/gw-01-live-turn-action-gateway-20261005.json`, `evidence/gw-01-chat-rdc-boundary-20261005.json`, `evidence/gw-01-multichat-live-20261006.json`, `docs/GW-01-MULTICHAT-LIVE-ACCEPTANCE-2026-10-06.md`. |
| GW-02 | Durable detached runs, handoff and interruption-safe parallel work | 🟨 **Y** | L | 65% | 4-8 h | Detached ownership includes a live-accepted prepared-dispatch path and survives the originating tool turn. Browser-turn/PID provenance now gives a stronger handoff substrate, but automatic ChatGPT turn→prepared dispatch is still missing. Remaining: explicit pause/stop/resume ownership, stale-heartbeat recovery/restart semantics, multi-run selection/parallel work, and automatic chat-root handoff. Evidence: `evidence/gw-02-detached-run-live-20261005.json`, `evidence/gw-02-prepared-dispatch-live-20261005.json`. |
| CT-01 | Freeze client/transport boundary: Web / Desktop / API / generic MCP | 🟩 **G** | XS | 100% | 0 h | `docs/CLIENTS-AND-TRANSPORTS.md` records the transport-neutral harness boundary, client matrix and validation order; README and Observer architecture link to it. |
| CT-02 | ChatGPT Web -> Harness live MCP path | 🟨 **Y** | M | 20% | 4-8 h | Official remote/Secure MCP Tunnel paths identified; repository has local MCP/OAuth pieces. Remaining: establish supported transport, tool discovery, auth and browser/local read acceptance sequence. |
| CT-03 | ChatGPT Desktop -> neutral local browser-read facade | 🟨 **Y** | M | 92% | <1 h | Desktop path has moved from localhost HTTP registration to a true local stdio MCP plugin. `plugins/local-shared-browser-pages/server.mjs` exposes only `list_tabs`, `read_page`, `find_in_page`, `bridge_status`; the stdio facade reaches the existing Chrome companion through a loopback pairing-protected read-only ingress, and a real MCP SDK probe returned `connected:true`. Remaining gate: install the refreshed `0.1.3` Desktop plugin and live-read the three explicitly shared Chrome tabs from a new ChatGPT conversation. |
| CT-04 | Responses API -> Harness MCP path | 🟨 **Y** | S | 10% | 2-4 h | Official `server_url` / `tunnel_id` path documented; no live API acceptance run yet. |
| CT-05 | Generic MCP host compatibility | 🟨 **Y** | M | 35% | 4-8 h | OpenCode 1.14.48 now discovers Harness MCP and reaches OAuth after the DCR compatibility repair, but the latest `mcp list` still reports needs authentication. Partial compatibility evidence, not end-to-end acceptance. Sufficiency: at least one non-OpenAI MCP host discovers and calls the same tools without a host-specific fork. |
| CT-06 | Portable execution profiles / onboarding | 🟨 **Y** | M | 22% | 4-8 h | Qwen/OpenCode/llama.cpp is the owner's current execution profile, not a universal stack. `docs/LOCAL-STACK-ONBOARDING-DRAFT.md` now inventories the first installation in detail: canonical repo/worktree, browser adapter, companion config, Desktop/Codex plugin, ports/processes, local-executor permissions, model runtime, detached state, knowledge/evidence, secret regeneration rules, source-of-truth vs disposable state, and a 12-phase second-install acceptance path. Explicit client/tool permission consent remains a user action and must not be bypassed. Remaining: turn this inventory into a declarative portable profile/install manifest plus repeatable bootstrap/uninstall automation and validate it on a clean second profile/machine. |
| KN-01 | Harness Knowledge Plane v0 + model-independent retrieval | 🟩 **G** | M | 82% | 1-2 h | Append-only events, curated evidence-linked records, schemas, dependency-free retrieval and automatic planner injection are live. Qwen receives retrieved knowledge but does not own canonical truth. Knowledge may contribute advisory, versioned projection/grouping rules, but must never mutate canonical raw timeline evidence; learned interpretation belongs to the projection ruleset, not the ledger. Remaining: supersession tooling/validation, richer indexing only when corpus size requires it, and observer visibility for knowledge hits. |
| KN-01.1 | Context anchoring: repo → task → run → knowledge + readiness | 🟩 **G** | S | 100% | 0 h | Live Qwen acceptance passed. Run `kn-01.1-live-20261005-0210` completed through local `qwen3.8-27b` in 83.281 s; persisted planning context matched canonical repo `execution-delivery-harness`, current HEAD and task `KN-01.1`, carried related tasks `CT-03`/`KN-01`, readiness `owner-local-v0`, and retrieved five scoped knowledge records. Task plane remains authoritative; knowledge remains advisory background. |
| LLM-01 | Local-first OpenCode/Qwen execution with bounded escalation | 🟨 **Y** | M | 78% | 2-4 h | The 4-step ceiling was a wrapper default, not a model/runtime limit. A live planner→worker CHR-01 run through OpenCode 1.14.48/Qwen3.8-27B/llama.cpp reached `max_steps` after making useful edits; semantic acceptance correctly reported failure while preserving artifacts/lifecycle state. Current automated suite is 90/90. Remaining: replace fixed step-count as the dominant work budget and complete Harness-owned verification/escalation. |
| LLM-02 | Capture exact serialized model request from OpenCode to runtime | 🟨 **Y** | S | 10% | 2-4 h | `task.txt` is not the full prompt; the exact serialized request OpenCode sends to the model/runtime must be captured. Remaining: capture and store the full serialized request for inspection. |
| LLM-03 | Observable architect-vs-worker routing | 🟨 **Y** | M | 10% | 4-8 h | Make architect-vs-worker routing observable. Target roughly 90% routine bounded work local and 10% ChatGPT supervision/escalation. Remaining: surface routing decisions in the observer and validate the split on live runs. |
| PL-01 | Local planner contract: task envelope + escalation packet | 🟩 **G** | S | 65% | 1-2 h | `docs/LOCAL-PLANNING.md`, machine-readable task/escalation schemas, reusable validator and contract tests define the boundary. Live planning exposed and fixed an unsafe design where model-authored acceptance could have become executable shell; acceptance is now declarative evidence only. Remaining: add the corresponding Harness-owned verifier contract and persist plan/checkpoint state. |
| PL-02 | Local intent decomposition into bounded worker tasks | 🟨 **Y** | M | 60% | 2-4 h | `scripts/local-planner.mjs` emits a validated bounded task and publishes durable lifecycle state. `scripts/run-task-envelope.mjs` preserves Harness-owned scope/profile/budget and has now live-run the Help envelope through OpenCode/Qwen without a ChatGPT-authored worker prompt. Remaining: tighten policy-derived request fields and connect successful worker output to Harness-owned verification/repair/escalation. |
| PL-03 | Local verification, repair decision and compact architect escalation | 🟨 **Y** | M | 18% | 4-8 h | Live OBS-02 worker exposed the concrete verifier requirement: `artifacts/observer-worker-acceptance.txt` satisfied the task marker and was the only changed file, while wrapper status was `worker_failed/max_steps_reached`. Verification must therefore consume worker report + acceptance evidence and classify semantic outcome independently of transport/step-budget termination, then choose done / one bounded repair / compact escalation. Evidence: `evidence/obs-02-worker-live-20261005.json`. |
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

### Timeline evidence invariants

The Observer timeline uses an immutable raw ledger with derived presentation layers.
These are hard design constraints, not optional UX preferences:

1. **Raw is append-only and authoritative.** Projection must never rewrite or delete source events.
2. **Every derived item is reversible.** Grouped/Semantic items carry exact source-event references and can drill down to Raw.
3. **Projection is versioned and reproducible.** Ruleset/version metadata must make historical re-projection explainable.
4. **Learned knowledge is advisory.** New grouping/semantic rules may reinterpret old evidence but may not mutate the ledger.
5. **Projection may omit from view; it may never omit from evidence.**

Update this file when evidence changes. Percentages should move because a
specific sufficiency condition was met or invalidated, not because time passed.
