# Harness Knowledge Plane v0

The Harness owns durable engineering knowledge. Models consume retrieved context; they are not the canonical store.

- `events.jsonl` — append-only chronology of observations, tests, decisions and supersessions.
- `records/*.json` — curated claims, decisions, runbooks, constraints and lessons with evidence.
- `schemas/` — machine-readable contracts.
- `scripts/knowledge.mjs` — local query/context CLI.

Examples:

```bash
node scripts/knowledge.mjs query "ChatGPT Desktop stdio plugin"
node scripts/knowledge.mjs context "CT-03 local browser plugin"
node scripts/knowledge.mjs show ct03.desktop-local-stdio
```

`context` is the intended model boundary. Qwen, ChatGPT, Codex or another model should receive this compact bundle rather than scraping the whole repository or relying on chat memory.

v0 retrieval is deliberately dependency-free lexical ranking. SQLite FTS5 / embeddings may replace the ranking implementation later without changing the record/event contracts.


## Context anchoring

Knowledge never replaces task state. Each curated record carries provenance:

- repository/worktree/branch/HEAD
- task IDs
- plan/run IDs when available
- source artifacts

Task-scoped retrieval is filtered against the current repository and related task IDs.
The planner receives two distinct blocks:

- `current_task_context` — authoritative repo/task/run/readiness state
- `retrieved_knowledge` — reusable background evidence

Each planning run persists `planning-context.json` plus `knowledge-context.json`.
