# Execution Delivery Harness status

Updated: **2026-10-09**

## Current stage

Execution Delivery Harness has four working layers:

1. **Read-only Browser Bridge** — explicit page-sharing and browser-read MCP contract.
2. **Local Executor** — bounded filesystem/terminal/process primitives behind explicit policy.
3. **Browser Bridge Observer** — immutable raw evidence plus reversible timeline/run projections in the Chrome Side Panel and local Observer surfaces.
4. **Gateway/orchestration substrate** — pre-dispatch correlation, prepared/detached execution state, lifecycle evidence, knowledge/context injection and browser-observed ChatGPT conversation/turn telemetry.

The owner-local workflow is substantially implemented, but `owner-local-v0` is
still blocked because routine repo/terminal execution from this ChatGPT Web path
continues to use Remote Desktop Commander and the local execution boundary is
still broader than the intended final policy/sandbox.

## Current version and test baseline

- Package / Chrome / Firefox development version: **0.1.46**.
- Active worktree: `chore/local-execution`.
- Current implementation checkpoint: `9ab7663` (`feat: add browser turn usage estimates`).
- Current documentation checkpoint before this cleanup: `ccef212`.
- Automated suite: **163/163 passing** on 2026-10-09.
- TODO catalog: **36 tasks, 4 complete, 62.5% simple average**. This average is informative only; release/readiness decisions are gate-based.
- Next configured milestone: `owner-local-v0` — **BLOCKED** by incomplete `BRW-01`, `LOC-01`, `LOC-02` and `SEC-01` gates.
- Pre-1.0 target interpretation: `0.2.0` is reserved for the owner-local routine execution loop, not for an arbitrary patch-count threshold.

## Verified locally

- Chrome unpacked Manifest V3 extension with Side Panel Observer.
- Loopback companion on `127.0.0.1:43119` with persistent local pairing.
- Explicit page grants and read-only browser tools.
- Firefox read-only synthetic smoke/observer surface (historical validation remains separate from current Chrome onboarding).
- Local Executor filesystem/process primitives with deny-by-default client policy.
- Unified timeline with literal Raw plus reversible Grouped/Semantic projections.
- Browser-observed ChatGPT conversation identity from `/c/<conversation_id>`.
- Browser TURN START/ACTIVE/DONE lifecycle with reload/recovery aliasing so a recovery UUID can continue the still-leased canonical turn instead of creating a duplicate lifecycle.
- Conservative `LIVE` activity and `WORKING / SETTLING / QUIESCENT` observer-inferred next-request boundary.
- Scoped source-chat navigation.
- Synthetic policy-test observer events isolated from the owner production ledger.
- Provider/runtime usage normalization for input/output/total/cache tokens, throughput and cost provenance.
- Observable ChatGPT Web visible-text estimates labeled `estimated`; hidden server/system/cache usage is not presented as exact.
- Historical local planner usage can be derived into separate `usage-backfill.json` artifacts without mutating raw planner responses.
- Durable task lifecycle, budget envelope and detached prepared-dispatch substrate.
- Knowledge plane and project/task/readiness context injection for local planning.
- Versioned extension reload UX: loaded-vs-disk mismatch is explicit and user-triggered; gateway restart does not imply extension reload.
- Owner-selectable executor policy (`AUTO / EDH / RDC / COMPARE`) before prepared dispatch; RDC is represented as a durable external-executor intent and COMPARE as sibling planned Runs, not as fake execution.
- Span/Task/Run causal navigation into Unified timeline; current Task/Run scopes are computed from the full ledger.
- Terminal lifecycle states retire the singleton `current-run.json` pointer into `last-run.json`; historical PASS results no longer remain selected as Current task.
- Hidden prepared-handoff controls are removed from layout and the executor selector uses stable grid geometry rather than wrapping flex rows.
- Backlog admission bridges `TODO.md`/readiness into a durable Current task. `Take next`/`Take selected` creates `WAITING / PLANNING_REQUIRED`; `Release` terminalizes it; a validated admitted `task.json` unlocks `Prepare handoff` and the existing executor policy.
- Git-derived Project trajectory exposes first commit, EDH identity start, wall-clock age, total/24h/average commit velocity, TODO-change checkpoints, daily readiness history and recent version milestones. Historical readiness is reconstructed from committed `TODO.md` snapshots and does not mutate project history.
- RDC executor adapter allocates an EDH Run/correlation before external execution, derives a minimized RDC capability set from bounded Task scope, records platform-approval state, accepts claim/start/tool/complete transitions, and renders the latest intent in Run ownership. The platform permission prompt/transport remains external.
- 0.1.46 canonical dashboard state plane replaces Side Panel fragment polling with one revisioned companion snapshot, background-owned cache/single-flight synchronization and 429 `THROTTLED` backoff while preserving the last good state. Expected active-turn baseline is ~124/240 bridge requests per minute rather than ~200/min from UI reads alone.

## Important current limitations

- Platform-managed ChatGPT Web -> RDC/MCP calls can still arrive without an authoritative conversation/turn marker. Such events remain Unscoped unless a trustworthy causal edge exists.
- `browser_observed` / `browser_inferred` are evidence-quality labels, not transport authority.
- `QUIESCENT` is observer-inferred until GW-01 owns the real dispatch boundary.
- ChatGPT Web token accounting is an estimate of observable visible text only; server-side prompt assembly, hidden system context, tool schemas, cache accounting and billed usage are unavailable unless explicitly reported by a provider/runtime.
- Local `local_exec_start` still represents a trusted-shell boundary inside allowed roots; stronger execution isolation or a narrower command contract remains open.
- This ChatGPT Web development path still uses Remote Desktop Commander for repo/terminal work; LOC-02 remains a hard `0.2.0` blocker.
- Full-width forensic Raw evidence inspection and independent `Compact / Normal / Forensic` density remain unfinished UI work.
- PAUSE / BREAK / STOP ALL execution-cycle semantics are incomplete.
- Harness-owned semantic verifier/repair/escalation remains incomplete.
- Firefox/Opera parity, AMO publication and public distribution are separate unfinished tracks.

## Chrome local installation

The canonical current guide is:

`docs/CHROME-LOCAL-INSTALL.md`

It defines prerequisites, companion startup, health check, pairing, unpacked Chrome
installation, Side Panel opening, verification, updates, stop/restart and
troubleshooting. `llama.cpp`, Ollama, OpenCode and a standalone Observer process
are explicitly optional for the minimum Chrome Side Panel path.

## Current architectural truth for chat attribution

```text
ChatGPT URL /c/<conversation_id>
        |
        v
browser-observed turn / short ownership lease
        |
        v
trustworthy scoped tool/process edge when one exists
        |
        +--> non-process span identity
        |
        +--> process_key = PID + start timestamp
                          -> TERM lifecycle
                          -> process_output / stop descendants
```

If zero or multiple browser turns plausibly own an otherwise-unscoped event, the
event remains Unscoped rather than being guessed from browser focus alone.

## Repository and release semantics

The active development worktree is currently clean and aligned with
`origin/chore/local-execution` before this documentation cleanup. Bulk runtime
run directories remain local-only; curated acceptance evidence belongs under
`evidence/`.

`TODO.md` is authoritative task state. `project/readiness.json` defines configured
milestone gates. `docs/PRE-1.0-RELEASE-MILESTONE-MODEL.md` defines why patch
versions are implementation checkpoints while pre-1.0 minor versions are named
capability boundaries.

Related canonical documents:

- `docs/CHROME-LOCAL-INSTALL.md`
- `docs/LOCAL-CONTROL-OBSERVATION-PLANE.md`
- `docs/OBSERVER-ARCHITECTURE.md`
- `docs/SIDE-PANEL-INFORMATION-ARCHITECTURE.md`
- `docs/EXECUTION-LIFECYCLES.md`
- `docs/EXECUTOR-COMPARISON.md`
- `docs/RDC-EXECUTOR-ADAPTER.md`
- `docs/STATE-PLANE.md`
- `docs/TASK-ADMISSION.md`
- `docs/CLIENTS-AND-TRANSPORTS.md`
- `docs/PRE-1.0-RELEASE-MILESTONE-MODEL.md`
- `TODO.md`
