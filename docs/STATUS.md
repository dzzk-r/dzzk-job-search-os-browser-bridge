# Execution Delivery Harness status

## Current stage

Execution Delivery Harness currently has four working layers:

1. **Read-only Browser Bridge** — explicit page-sharing and browser-read MCP contract.
2. **Local Executor** — bounded filesystem/terminal/process operations behind explicit policy.
3. **Browser Bridge Observer** — one global event ledger plus causal/run projections in TUI and Chrome Side Panel.
4. **Gateway / orchestration substrate** — pre-dispatch correlation, prepared detached dispatch, durable lifecycle, knowledge/context injection and browser-observed ChatGPT conversation/turn evidence.

The local owner workflow is substantially implemented, but the repository is not yet release-clean and ChatGPT Web tool dispatch is still not authoritative end-to-end.

## Current version and test baseline

- Package / Chrome / Firefox version: **0.1.14**
- Active worktree: `chore/local-execution`
- Checkpoint base: `f9a5091`; stabilized checkpoint commits follow on `chore/local-execution`
- Automated suite: **90/90 passing** on 2026-10-06
- TODO aggregate: **59% average, 4/36 tasks at 100%**. The count increased because UI-01 now tracks Side Panel information architecture explicitly instead of hiding that work inside CHR/OBS tasks.
- Milestone gate `owner-local-v0`: still blocked by unfinished Local Executor critical-path replacement / execution isolation work.

The live-acceptance worktree has been classified and stabilized into separate implementation, evidence/knowledge, and documentation checkpoint commits. Bulk runtime run directories remain local-only; compact acceptance evidence is committed under `evidence/`.

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
- Versioned extension reload UX is live-accepted: loaded-vs-disk semver mismatch is shown in Side Panel, reload is explicit user action, and the mismatch control disappears after the requested version loads.
- Gateway restart no longer implies extension reload.
- Side Panel now compares running gateway identity with repository state: runtime commit + runtime server-file hash vs current repo HEAD + disk server-file hash; a mismatch is surfaced as Gateway restart <old> → <new>.
- Knowledge plane and project/task context injection for local planning.

## Important current limitations

- Platform-managed ChatGPT Web → RDC/MCP calls can still arrive without an authoritative conversation/turn marker. Such events remain **Unscoped** unless a trustworthy causal edge exists.
- Browser-observed attribution is explicitly labeled `browser_observed` / `browser_inferred`; it is not transport authority.
- Generic MCP operations such as `read_file`, `list_tabs` and `bridge_status` have no PID. PID propagation only helps after a process-producing call such as `start_process` has already been scoped.
- Unified timeline is still noisy. Raw evidence is literal; semantic compaction of polling/diagnostic repetition remains unfinished.
- Chrome Side Panel visual containment was repaired again during live acceptance and still needs final visual acceptance on the loaded 0.1.14 build.
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

## Repository checkpoint state

The 2026-10-06 live-acceptance pile has been stabilized:

1. executable code/tests and installable manifests are one implementation checkpoint;
2. curated acceptance evidence and knowledge records are a separate checkpoint;
3. project status/documentation are a separate checkpoint;
4. Python bytecode and bulk runtime `runs/` are excluded from Git;
5. full automated suite passes 91/91.

Remaining repository work is to keep the checkpoint branch pushed and review integration into `main`; further feature work should not recreate a mixed uncommitted pile.

See `TODO.md` for authoritative task state and `project/readiness.json` for milestone definitions.

Side Panel semantic/UI design baseline: `docs/SIDE-PANEL-INFORMATION-ARCHITECTURE.md`.
