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
| CHR-01 | Chrome Side Panel Observer + safe share controls | 🟩 **G** | S | 92% | <1 h | Observer, full-panel settings, target preview, explicit share controls and real `?` Help/Run inspection are implemented. Remaining: reload/UI acceptance of Help and the next live run. |
| FFX-01 | Firefox Browser Bridge + Observer adapter | 🟩 **G** | M | 70% | 2-4 h | Read-only bridge synthetic smoke and observer page exist. Remaining: verify intended sidebar/operator surface against current shared observer contract. |
| OPR-01 | Opera/Chromium Observer adapter | 🟨 **Y** | M | 10% | 4-8 h | Architecture expects a Chromium-family adapter; compatibility has not been verified. |
| LOC-01 | Local Executor MCP namespace for filesystem + terminal + process control | 🟨 **Y** | M | 70% | 4-8 h | `local_status/list_dir/read_file/write_file/exec_start/process_output/process_stop` implemented and tested; local methods default Block. Remaining: live MCP-host use and hardening around trusted shell. |
| LOC-02 | Remove Remote Desktop Commander from the filesystem/terminal/process critical path | 🟨 **Y** | L | 60% | 1-2 d | Replacement primitives exist locally. Remaining: connect them to the actual client path, prove routine work without Remote Desktop Commander, keep it only as optional GUI/emergency fallback. |
| SEC-01 | Local execution isolation beyond trusted-shell `cwd` | 🟨 **Y** | M | 30% | 4-8 h | Filesystem methods enforce roots/realpath/symlink rules and optimistic writes; `local_exec_start` is explicitly still trusted shell. Sufficiency: enforce a real execution policy/sandbox or a deliberately narrower command contract. |
| OBS-01 | Browser-neutral actor registry and lifecycle rendering | 🟩 **G** | M | 85% | 1-2 h | Actor registry, TUI/Side Panel, spans, timeline and run-inspection projection now exist. Remaining: validate the shared contract on the next live run and then across Firefox/Opera adapters. |
| OBS-02 | Actor activity truth: registry vs live activity and local-agent event visibility | 🟩 **G** | S | 100% | 0 h | Live 2026-10-04 run visibly showed OC -> QWEN -> LLAMA activity with corresponding timeline events, then returned actors to idle. TERM no longer treats a merely alive shell as active; Git Δn is state, not activity. |
| OBS-03 | Run provenance, failure reason and artifact/log inspection | 🟨 **Y** | S | 90% | <1 h | Observer now projects task/prompt, OpenCode/model, budget, elapsed/process exit, semantic outcome reason, expected/changed files and artifact paths (`task.txt`, `config.json`, `command.json`, `events.log`, `report.json`). Remaining: reload/UI acceptance and verify the next failed/successful run renders its reason without log archaeology. |
| GW-01 | Pre-dispatch MCP gateway with authoritative spans/lease/heartbeat | 🟨 **Y** | L | 25% | 1-2 d | Architecture is specified; current completed-history reconstruction cannot prove an in-flight ChatGPT/MCP turn. Sufficiency: START before dispatch and terminal DONE/ERROR/TIMEOUT/CANCELED with correlation. |
| CT-01 | Freeze client/transport boundary: Web / Desktop / API / generic MCP | 🟩 **G** | XS | 100% | 0 h | `docs/CLIENTS-AND-TRANSPORTS.md` records the transport-neutral harness boundary, client matrix and validation order; README and Observer architecture link to it. |
| CT-02 | ChatGPT Web -> Harness live MCP path | 🟨 **Y** | M | 20% | 4-8 h | Official remote/Secure MCP Tunnel paths identified; repository has local MCP/OAuth pieces. Remaining: establish supported transport, tool discovery, auth and browser/local read acceptance sequence. |
| CT-03 | ChatGPT Desktop -> Harness local MCP/plugin path | 🟨 **Y** | M | 10% | 4-8 h | Product path documented; no repository packaging/live verification yet. Sufficiency: same tool contract available in Desktop without changing Browser Bridge/Local Executor semantics. |
| CT-04 | Responses API -> Harness MCP path | 🟨 **Y** | S | 10% | 2-4 h | Official `server_url` / `tunnel_id` path documented; no live API acceptance run yet. |
| CT-05 | Generic MCP host compatibility | 🟨 **Y** | M | 20% | 4-8 h | MCP is the intended host-neutral boundary. Sufficiency: at least one non-OpenAI MCP host discovers and calls the same tools without a host-specific fork. |
| LLM-01 | Local-first OpenCode/Qwen execution with bounded escalation | 🟨 **Y** | M | 72% | 2-4 h | A real Chrome Help implementation task ran through OpenCode 1.14.48 -> local Qwen3.8-27B -> llama.cpp and was observed live. It failed semantically at the 4-step budget, exposing the need for task-level outcome/provenance and budget tuning. Remaining: rerun after inspection UI, complete a reviewed artifact, then make this the routine implementation path. |
| REL-01 | Live ChatGPT OAuth/tool-discovery validation | 🟨 **Y** | M | 25% | 4-8 h | OAuth/PKCE behavior is covered synthetically; live account linking/tool discovery is explicitly unverified. |
| REL-02 | AMO signing/publication and signed Firefox install | 🟨 **Y** | L | 45% | 1-2 d | Listing/privacy/validation material and unsigned package path exist. Remaining includes account submission, review/signing and signed-XPI smoke; external review latency is excluded from ETA. |
| REL-03 | Public ChatGPT plugin/distribution path | 🟥 **R** | XL | 10% | 3-5 d | Private/developer connectivity is not public distribution. Public submission requires a stable publicly reachable HTTPS MCP endpoint and separate review/distribution work. Do not conflate Secure MCP Tunnel with this task. |

## Current delivery gates

**Green gate - local user-owned loop:** Browser Bridge and Local Executor can be
used through the harness without Remote Desktop Commander for routine
filesystem/terminal/process work, with explicit page and local-operation policy.

**Yellow gate - client portability:** the same MCP tool contract passes the
acceptance sequence from ChatGPT Web, ChatGPT Desktop and the Responses API
without forking Browser Bridge or Local Executor semantics.

**Red gate - distribution:** signed/public browser packages and any public
ChatGPT/plugin distribution are separately reviewed release tracks. Private
developer connectivity does not satisfy this gate.

Update this file when evidence changes. Percentages should move because a
specific sufficiency condition was met or invalidated, not because time passed.
