# Execution Delivery Harness status

## Current stage

Execution Delivery Harness currently has four working layers:

1. **Read-only Browser Bridge** — explicit page-sharing and browser-read MCP contract.
2. **Local Executor** — bounded filesystem/terminal/process operations behind explicit policy.
3. **Browser Bridge Observer** — one global event ledger plus causal/run projections in TUI and Chrome Side Panel.
4. **Gateway / orchestration substrate** — pre-dispatch correlation, prepared detached dispatch, durable lifecycle, knowledge/context injection and browser-observed ChatGPT conversation/turn evidence.

The local owner workflow is substantially implemented, but the repository is not yet release-clean and ChatGPT Web tool dispatch is still not authoritative end-to-end.

## Current version and test baseline

- Package / Chrome / Firefox version: **0.1.3**
- Active worktree: `chore/local-execution`
- Git HEAD: `f9a5091`
- Automated suite: **90/90 passing** on 2026-10-06
- TODO aggregate: **58% average, 4/35 tasks at 100%**
- Milestone gate `owner-local-v0`: still blocked by unfinished Local Executor critical-path replacement / execution isolation work.

The worktree is intentionally dirty pending stabilization and commit slicing. Do not treat HEAD alone as the current implementation state.

## Verified locally

- Chrome unpacked extension with live Side Panel Observer.
- Firefox read-only bridge synthetic smoke and observer surface.
- Explicit page grants and browser read tools.
- Local Executor filesystem/process primitives with deny-by-default client policy.
- Observer timeline from MCP history, terminal lifecycle, OpenCode/Qwen, llama.cpp and Git.
- Controlled CHAT→ACTION→TERM→OC→QWEN→LLAMA correlation for Harness-owned work.
- Durable task lifecycle and detached prepared-dispatch path.
- Real ChatGPT Web conversation identity derived from `/c/<conversation_id>`.
- Named conversation scopes in Unified timeline; selecting a known conversation filters its scoped evidence.
- Browser-observed ChatGPT TURN START/ACTIVE/DONE lifecycle and conservative single-active-turn attribution substrate.
- PID/process descendants can inherit an already-scoped launch after the browser turn lease ends.
- Versioned extension reload UX: loaded-vs-disk semver mismatch is shown in Side Panel; reload is explicit user action.
- Gateway restart no longer implies extension reload.
- Knowledge plane and project/task context injection for local planning.

## Important current limitations

- Platform-managed ChatGPT Web → RDC/MCP calls can still arrive without an authoritative conversation/turn marker. Such events remain **Unscoped** unless a trustworthy causal edge exists.
- Browser-observed attribution is explicitly labeled `browser_observed` / `browser_inferred`; it is not transport authority.
- Generic MCP operations such as `read_file`, `list_tabs` and `bridge_status` have no PID. PID propagation only helps after a process-producing call such as `start_process` has already been scoped.
- Unified timeline is still noisy. Raw evidence is literal; semantic compaction of polling/diagnostic repetition remains unfinished.
- Chrome Side Panel visual containment was repaired again during live acceptance and still needs final visual acceptance on the loaded 0.1.3 build.
- PAUSE / BREAK / STOP ALL semantics are not complete.
- Harness-owned semantic verifier/repair/escalation remains incomplete.
- This ChatGPT Web session still uses Remote Desktop Commander for repository work; LOC-02 therefore remains open.
- Firefox/Opera parity, AMO publication and public distribution are separate unfinished tracks.

## Current architectural truth for chat attribution

```text
ChatGPT URL /c/<conversation_id>
        |
        v
browser-observed turn / short ownership lease
        |
        v
first scoped MCP/tool span
        |
        +--> non-process tool span identity
        |
        +--> start_process -> PID + start timestamp
                          -> TERM lifecycle
                          -> process_output / stop descendants
```

The browser lifecycle detector is only a bridge for the first causal edge. Once a tool/span or process instance has trustworthy ancestry, normal span/PID propagation should carry the scope.

If zero or multiple browser turns plausibly own an otherwise-unscoped event, the event remains Unscoped rather than being guessed from focus or timestamp alone.

## Repository debt before further feature work

Current live work accumulated multiple logical changes in one dirty worktree: Browser/GW/Observer, Local Executor/planner, knowledge/project context, prepared detached dispatch, docs/evidence and runtime-generated files. Before substantial new feature work:

1. classify canonical source vs generated/disposable artifacts;
2. remove disposable state such as Python bytecode;
3. slice the worktree into reviewed logical commits;
4. run tests per slice;
5. push checkpoints on `chore/local-execution`;
6. only then plan integration to `main`.

See `TODO.md` for authoritative task state and `project/readiness.json` for milestone definitions.
