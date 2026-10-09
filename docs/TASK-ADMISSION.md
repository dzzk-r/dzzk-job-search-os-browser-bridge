# Project backlog to runtime Task admission

Status: **0.1.43 vertical slice**

Execution Delivery Harness distinguishes three different objects:

```text
Project backlog item (TODO.md)
        ↓ Take / Admit
Runtime Current task (durable lifecycle)
        ↓ bounded task.json exists and validates
Prepared handoff
        ↓ Dispatch
Run / executor / evidence
```

A backlog row is not automatically an executable task. `TODO.md` contains project
work, progress and evidence notes, but it usually does not contain a safe exact
write scope, bounded acceptance contract or executor budget.

## Backlog catalog

The Side Panel `Project readiness` block reads the task catalog from `TODO.md` and
milestone gates from `project/readiness.json`.

`36 tracked tasks` therefore means project backlog rows, not 36 queued runtime
jobs.

## Recommendation

The admission service orders incomplete items as follows:

1. unfinished supporting tasks of the next blocked milestone;
2. other incomplete backlog items;
3. inside each class, higher completion percentage first, then stable ID order.

The recommendation is advisory. The owner can choose another incomplete item.

## Take

`Take next` or `Take selected` creates a durable admission record and immediately
creates a lifecycle-backed Current task.

The admitted runtime task starts as:

```text
status = WAITING
phase  = PLANNING_REQUIRED
```

with explicit pending work:

- confirm exact scope;
- define concrete acceptance;
- persist a bounded `task.json`;
- prepare handoff.

The admission cannot silently replace another non-terminal Current task. The
owner must release/cancel the current admission first.

## Release

`Release current` terminalizes the admitted lifecycle as `CANCELED / RELEASED`,
retires `current-run.json` through the normal lifecycle mechanism and preserves
the admission/run artifacts as history.

## Bounded envelope gate

EDH does not dispatch the raw TODO row.

The admitted run becomes handoff-eligible only when:

```text
<admission-run>/task.json
```

exists and validates against `schemas/task-envelope.schema.json`.

Until then the UI reports `PLANNING REQUIRED` and `Prepare handoff` remains
disabled.

When the envelope validates, the UI reports `BOUNDED TASK READY`. `Prepare
handoff` then creates the ordinary prepared-dispatch state and moves the Current
task lifecycle to:

```text
WAITING / READY_FOR_HANDOFF
```

The existing executor policy then applies unchanged:

```text
AUTO | EDH | RDC | COMPARE
```

## Why planning is still a separate step

The current local planner contract deliberately forbids the model from widening
Harness-owned scope. A TODO row often does not contain enough information to
construct `scope.reads`, `scope.writes`, concrete acceptance and risk safely.

0.1.43 therefore does **not** invent a repository-wide write scope or silently
turn free-form TODO text into executable authority.

The next planning increment should produce a reviewable bounded envelope under a
Harness-owned scope ceiling, then require validation/owner approval before the
handoff becomes executable.

## Durable state

Admission state:

```text
~/.local/state/execution-delivery-harness/task-admission.json
```

Current task lifecycle:

```text
~/.local/state/execution-delivery-harness/current-run.json
```

Admission runs:

```text
~/WORK/browser-bridge-runs/admissions/<timestamp>-<backlog-id>/
```

Typical artifacts:

```text
admission.json
checkpoint.json
lifecycle.jsonl
task.json            # only after bounded planning has produced it
turn-context.json    # written when preparing a handoff
```

Terminal/released tasks retire through the standard lifecycle path rather than
being deleted.
