# Local planning and orchestration

## Purpose

Execution Delivery Harness must not depend on ChatGPT manually turning every user
intent into a worker prompt. The target local-first loop is:

```text
user intent
    -> local planner
    -> bounded task envelope(s)
    -> local worker/executor
    -> local verification
    -> done | next task | escalation packet
```

ChatGPT remains a supervising architect/escalation target for ambiguity,
contradictory evidence, policy/security decisions, repeated bounded failure or
changes to public contracts. Routine decomposition, task-envelope generation and
verification belong locally.

## Planner responsibilities

The planner may:

- turn one user goal into a small ordered plan or dependency graph;
- gather only the evidence needed to define the next bounded task;
- choose an execution profile already authorized by policy;
- emit one or more task envelopes that validate against
  `schemas/task-envelope.schema.json`;
- track completed/current/pending plan items and acceptance results;
- request another local repair when policy permits;
- emit an escalation packet that validates against
  `schemas/escalation-packet.schema.json`.

The planner must not:

- silently expand filesystem/browser/tool permissions;
- treat a process exit code as task acceptance;
- manufacture a task-completion percentage from token, wall-clock or agent-step
  budget;
- hide contradictory evidence;
- make destructive, irreversible, security-boundary or user-consent decisions;
- require ChatGPT to read the full raw event log for ordinary success/failure.

## Task envelope

A task envelope is the worker contract, not free-form advice. It contains:

- stable task and parent-plan identity;
- the goal and evidence that justify the task;
- explicit read/write/tool scope;
- constraints and non-goals;
- declarative acceptance criteria and required evidence; planner output is never executed as shell code;
- risk class;
- execution budget;
- escalation conditions;
- expected artifacts;
- source provenance and selected execution profile.

The worker may propose a narrower envelope but may not widen permissions or
acceptance criteria. The planner owns decomposition; the worker owns bounded
execution.

## Local verification

After each worker run, verification answers:

1. Did the requested artifact change as expected?
2. Did the stated acceptance checks pass?
3. Did execution remain inside scope and policy?
4. Is the plan item complete, repairable locally, blocked, or ambiguous?

Process truth and task truth remain separate. `exit=0` is never sufficient by
itself.

## Escalation

Escalation is an explicit product of local planning, not a fallback to dumping
logs into ChatGPT. Escalate only when at least one declared condition is met,
such as:

- security/access-control boundary or privilege change;
- destructive/irreversible action;
- conflicting source-of-truth evidence;
- change to a public/stable contract;
- missing user decision/credential;
- bounded local repair budget exhausted;
- planner cannot choose between materially different architectures.

The escalation packet contains the exact decision required, compact evidence,
attempts already made, viable options, the planner's current recommendation,
artifact/trace locators and one narrow question for the architect.

Raw logs remain local drill-down evidence. ChatGPT should normally receive the
escalation packet plus only the cited excerpts needed for the decision.

## Observer contract

Planner state must be observable as first-class run state:

```text
plan_id
goal
items: completed / current / pending / blocked
current_task_id
acceptance checklist
budget used / remaining
waiting reason
safe_to_interrupt
last durable checkpoint
next action
```

The Observer must correlate planner -> worker -> model/runtime -> tool/artifact
spans using gateway correlation IDs. A new user turn must not implicitly destroy
a durable local plan/run.

## Current owner profile

The current owner profile is OpenCode 1.14.48 with Qwen3.8-27B through
llama.cpp. This is evidence for one execution profile, not the portable planner
contract. Other users may select different executors, providers, models or no
local model at all.

## First implementation slice

The first implementation should be intentionally small:

1. validate task-envelope and escalation-packet documents;
2. persist `plan.json` plus current `task.json` in the run directory;
3. let a local planner emit one bounded task from a supplied goal/evidence set — implemented as the first `scripts/local-planner.mjs` slice and live-smoked on 2026-10-04;
4. run the existing local worker against that validated envelope;
5. write verification and either mark the item complete or emit
   `escalation.json`;
6. expose the compact plan/checkpoint through Observer before attempting
   autonomous multi-task planning.

Do not build a general autonomous agent before this slice is observable and
accepted.
