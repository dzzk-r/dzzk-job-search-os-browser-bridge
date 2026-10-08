# Executor comparison and dispatch policy

Status: **0.1.41 control-plane baseline**

EDH now has an owner-selectable executor policy for the next prepared task:

```text
AUTO | EDH | RDC | COMPARE
```

The policy is persisted by the local companion. It is part of the dispatch
control plane, not a presentation-only preference.

## Current semantics

### AUTO

Uses the current Harness default. In 0.1.41 this resolves to the existing EDH
prepared/detached execution path.

### EDH

Routes the prepared task into the Harness-owned detached execution path. The
prepared task is admitted against the currently observed ChatGPT conversation
before launch.

### RDC

EDH does **not** pretend that the local companion can directly invoke Remote
Desktop Commander. Instead it writes a durable external-executor dispatch intent
with status:

```text
AWAITING_EXTERNAL_EXECUTOR
```

The intent records task/plan identity, baseline commit, conversation/turn when
known, acceptance and budget. A later RDC adapter/manual handoff can consume this
intent and write its own Run evidence.

### COMPARE

Creates a durable comparison plan with two sibling Runs:

```text
Task T
  ├── Run A · executor=EDH · PLANNED
  └── Run B · executor=RDC · PLANNED
```

Both Runs share:

- the same Task envelope;
- the same baseline commit;
- the same acceptance criteria;
- the same declared task budget.

0.1.41 does **not** yet execute both siblings automatically and does not choose a
winner. That is the next implementation step.

## Intended comparison isolation

Real comparison execution must not run sequentially in one mutable worktree.
The target is two isolated worktrees from the same baseline:

```text
<comparison>/edh/
<comparison>/rdc/
```

Each Run should produce its own artifacts, lifecycle evidence and test/acceptance
result.

## Intended scoring

The comparison record already reserves result dimensions for:

- acceptance result;
- tests;
- elapsed time;
- tool calls;
- token/model usage;
- human interventions;
- scope violations;
- final winner/recommendation.

Future scoring should distinguish objective acceptance from optimization. A
faster executor must not be declared the winner if it violated scope or failed
acceptance.

## Dispatch authority

This policy is one step toward authoritative dispatch because the executor choice
is made **before** execution inside EDH.

The target causal chain is:

```text
Task / Turn
  -> EDH dispatch policy
  -> admitted Run / correlation
  -> selected executor backend
  -> spans / events / artifacts
```

However, platform-managed ChatGPT Web calls that bypass this path and directly
invoke RDC/MCP are still only observed/inferred after the fact. GW-01 is not
closed until routine tool execution enters the EDH dispatch boundary before the
executor runs.

## Evidence navigation in 0.1.41

The Side Panel now begins to expose the same causal graph instead of isolated
lists:

- Execution Span -> **Show in timeline**;
- Current Task -> **Show task timeline**;
- Current Run -> **Show run timeline**;
- task/run scopes are generated from the full ledger for the current lifecycle,
  not only from the latest 300 global events;
- old terminal spans are excluded from the operational `recent` list unless they
  belong to the current task/run/chat or finished inside the short recent window.

Raw evidence is unchanged.
