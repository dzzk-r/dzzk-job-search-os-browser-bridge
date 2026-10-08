# Execution Delivery Harness — pre-1.0 release milestone model

Status: proposed normative release rationale  
Baseline when written: 2026-10-08, extension/package `0.1.39`, branch `chore/local-execution`
Current checkpoint: `9ab7663`

## Why this document exists

Execution Delivery Harness already changes faster than a patch-number sequence can explain.
`0.1.33` through `0.1.39` identify concrete builds, but they do not answer the more important question:

> What capability boundary must become true before the project may honestly call itself `0.2.0`?

This document separates **build/version identity** from **delivery readiness** and defines a pre-1.0 interpretation for minor versions.
It is intended to guide future task decomposition, milestone gates and release decisions.

The central rule is:

> **A pre-1.0 minor version is a capability milestone, not a progress counter.**

For shorthand, the current proposed sequence is:

```text
0.1.x  owner-local-observer / foundation
0.2.x  owner-local-execution
0.3.x  portable-private execution
0.4+   unassigned until the capability contract is known
```

Therefore `0.1.99` does not automatically become `0.2.0`, and `0.2.0` does not require every project task to be complete.
A minor transition happens only when its named capability contract is demonstrated end to end.

---

## Version semantics before 1.0

### PATCH — `0.x.PATCH`

Patch releases are implementation increments inside one capability milestone.
They may add substantial code, UI, diagnostics or safety fixes without changing the milestone contract.

Examples from the current `0.1.x` line:

- source-chat navigation;
- Raw / Grouped / Semantic timeline projections;
- observer evidence isolation;
- live-state and attribution corrections;
- Side Panel information architecture refinement;
- provenance and causal-debugging improvements.

A patch answers:

> **Which concrete implementation checkpoint is this?**

It does not answer:

> **How close are we numerically to the next minor?**

### MINOR — `0.MINOR.0`

A minor transition means one new system capability becomes routine, bounded and demonstrable.
It must have:

1. a named capability contract;
2. explicit release gates;
3. at least one real acceptance scenario;
4. durable evidence that the scenario passed;
5. no known blocker that contradicts the capability claim.

A minor answers:

> **What can the Harness now be trusted to do that the previous minor could not honestly claim?**

### `1.0.0`

`1.0.0` is intentionally not defined here.
It should not be inferred as “the next number after enough 0.x releases”.
A stable public contract, compatibility policy, distribution model and operational expectations should be defined separately before 1.0 is assigned.

---

# Proposed capability sequence

## `0.1.x` — Owner-local Observer / execution foundation

### Capability claim

The Harness can **observe, model and partially orchestrate** owner-local work while preserving evidence and provenance.

This line establishes the substrate on which later execution claims depend:

- Browser Bridge and explicit page grants;
- local execution primitives;
- unified Observer timeline;
- immutable raw evidence;
- causal/provenance model;
- ChatGPT conversation and turn observation;
- Task / Dispatch / Run lifecycle model;
- detached-run substrate;
- project/readiness and knowledge context;
- reversible Raw / Grouped / Semantic projections.

### What `0.1.x` does *not* claim

It does not yet claim that EDH is the normal execution path for its own work.
In particular, routine repository/terminal execution may still depend on Remote Desktop Commander.

The distinction is deliberate:

```text
0.1.x
observe / explain / correlate / prepare / partially orchestrate

            !=

routine bounded execution owned by EDH
```

### Exit condition

`0.1.x` ends when the Observer/foundation layer is good enough to support a real owner-local execution loop and the remaining blockers are primarily execution-path blockers rather than missing observability primitives.

The project is currently in this late-`0.1` state.

---

## `0.2.0` — Owner-local execution

### Capability claim

A real owner can give the Harness a routine bounded task and EDH can carry it from admission through execution and verification **without Remote Desktop Commander on the normal filesystem/terminal/process critical path**.

A canonical acceptance scenario is:

```text
User request / Chat context
        ↓
Harness admission
        ↓
Task / bounded envelope
        ↓
EDH local read / write / process execution
        ↓
tests / verifier
        ↓
result + artifacts
        ↓
Git checkpoint when explicitly allowed
        ↓
Observer evidence / provenance
```

Remote Desktop Commander may still exist as:

- bootstrap;
- GUI-only capability;
- emergency/recovery path;
- diagnostic fallback.

It must no longer be the ordinary hand used to perform repo/filesystem/terminal work that EDH claims to own.

### Relationship to `owner-local-v0`

The existing machine-readable milestone `owner-local-v0` is the closest current readiness gate to the `0.2.0` release claim.
Its definition is already strong and useful:

> A real client completes a routine user-owned operation through Harness browser/local policy without Remote Desktop Commander on the critical path.

`0.2.0` should therefore treat `owner-local-v0` as a **necessary release gate**, but not blindly equate the two concepts:

- `owner-local-v0` is a project-readiness milestone;
- `0.2.0` is a release/capability boundary;
- the same tasks may support both;
- release-specific acceptance and evidence may add requirements beyond the project milestone.

### Minimum release gates

The following must be true before `0.2.0` is honest:

#### A. Owner-local execution path

- `LOC-01`: local filesystem/process primitives are live through the intended client path;
- `LOC-02`: RDC is removed from the routine filesystem/terminal/process critical path;
- browser/local policy is enforced on the real path, not only in synthetic tests.

#### B. Minimum execution boundary

- `SEC-01`: execution is no longer an unconstrained “trusted shell” claim;
- either a real sandbox/policy boundary exists, or the command contract is deliberately narrowed enough that the release claim is accurate;
- the remaining blast radius is documented and visible.

#### C. Observable and reversible evidence

- Raw evidence remains authoritative and immutable;
- Grouped/Semantic projection is reversible to exact source events;
- failures and unknown outcomes are represented without inventing success;
- test/synthetic evidence is isolated from the owner production ledger.

#### D. Task → Run → Verification loop

- a routine task can be admitted and dispatched;
- progress/ownership is visible;
- completion is verified by Harness-owned acceptance logic appropriate to the task;
- result/artifact provenance remains inspectable.

#### E. Real acceptance run

At least one non-toy owner task must complete through the intended EDH path without RDC on the critical path.
The run must leave enough durable evidence to reproduce the reasoning about why it passed.

### Explicit non-gates for `0.2.0`

The following are valuable but should not block `0.2.0` unless the release claim is expanded to include them:

- AMO/public Firefox publication;
- public ChatGPT distribution;
- full client portability;
- second-machine bootstrap;
- every `CT-*` transport;
- perfect Semantic projection coverage;
- multi-project federation;
- public multi-user operation.

### Release decision rule

`0.2.0` should be cut when this sentence is demonstrably true:

> **EDH is now the normal bounded execution path for one owner's routine local work, and the Observer can explain that execution from request to evidence without relying on RDC as the executor.**

---

## `0.3.0` — Portable-private execution contract

### Capability claim

The owner-local execution contract proven in `0.2.x` works from the intended private clients/transports without creating a different Harness semantics for each client.

This maps naturally to the existing `portable-private-v0` readiness milestone:

> The same transport-neutral contract passes acceptance from the intended private clients without forking Browser Bridge or Local Executor semantics.

Likely work includes:

- ChatGPT Desktop/local plugin acceptance;
- supported ChatGPT Web path where available;
- at least one generic MCP host;
- transport-neutral identity/admission semantics;
- portable permission/profile configuration;
- repeatable private installation/bootstrap;
- clean separation between client transport and canonical Task/Run/evidence semantics.

The important invariant is:

```text
client / transport may change
        ↓
Harness execution contract does not fork
```

### Non-goal

`0.3.0` should not automatically mean public marketplace/store distribution.
Private portability and public distribution are separate risk and review domains.

---

## `0.4+` — intentionally unassigned

Do not reserve later minor numbers merely to make a roadmap look complete.
Potential future capability boundaries include:

- durable cross-device/external-gateway continuity;
- multi-device executor federation;
- public distribution;
- multi-user/organization governance;
- stronger execution isolation;
- remote execution profiles.

These should receive minor numbers only after their contracts and ordering are understood.

The existing `public-distribution-v1` project milestone therefore remains real and useful, but this document deliberately does **not** assert that it must equal `0.4.0`.

---

# Orthogonal coordinates: do not collapse them

EDH has several different notions of progress. They must remain distinct.

## Build identity

Example:

```text
0.1.35
```

Answers: **which implementation checkpoint is loaded?**

## Release target

Example:

```text
Target: 0.2.0 — Owner-local usable execution loop
```

Answers: **which capability boundary are we trying to make true?**

## Project milestone

Example:

```text
owner-local-v0
portable-private-v0
```

Answers: **which configured project-readiness gate is blocked or ready?**

## Task readiness

Example:

```text
LOC-02 55%
SEC-01 30%
```

Answers: **what work remains inside the project graph?**

A useful UI may show all four, but it must not imply that they are the same measurement.

---

# How patch releases should report progress toward the next minor

Each `0.1.x` release should be able to say which `0.2.0` gate it advanced.

Example:

```text
0.1.34
  advanced: Observable/reversible evidence
  evidence: Raw / Grouped / Semantic projection

0.1.35
  advanced: Evidence integrity
  evidence: synthetic policy-test events isolated from owner ledger

0.1.36
  advanced: Observable execution accounting
  evidence: provenance-labeled model/provider tokens, cache, throughput and cost telemetry

0.1.37
  advanced: Observable turn quiescence / safe-next-request semantics
  evidence: LIVE activity is separated from WORKING / SETTLING / QUIESCENT with a conservative quiet-window boundary

0.1.38
  advanced: Human-readable observability/accounting presentation
  evidence: structured LIVE status card, freshness timestamp, budget components, token-quality badges and role-aware model/provider/agent/transport/tool resources

0.1.39
  advanced: Browser-turn continuity and observable ChatGPT Web accounting
  evidence: reload/recovery START aliases to the existing leased canonical turn; visible user/assistant text is converted only to labeled local estimates, never persisted as message content; historical local planner usage can be backfilled into separate derived artifacts without mutating raw evidence
```

This is preferable to pretending that the patch number itself encodes progress.

A future release/status projection may use a compact form such as:

```text
Target 0.2.0 · Owner-local execution

Evidence / Observer        ACCEPTING
Identity / provenance      NEAR READY
Execution primitives       PARTIAL
RDC removal                BLOCKED
Execution isolation        BLOCKED
End-to-end owner loop      NOT YET PROVEN
```

Avoid false numeric precision unless the gates themselves define a justified calculation.

---

# Relationship to the Observer

The Observer is not merely UI polish on the road to `0.2.0`.
It provides the evidence boundary needed to make execution claims safely.

Before the Harness performs routine work, the system must be able to answer:

- who initiated the action;
- which Project/Task/Run caused it;
- which capabilities were granted;
- which resource was touched;
- which executor/tool performed the action;
- what the observed outcome was;
- whether the outcome is known, inferred or unknown;
- which immutable evidence supports the projection.

Therefore `0.1.x` is best understood as the **owner-local observability/provenance foundation**, not as disposable prototype work.

The Observer contract remains:

```text
immutable raw evidence
        ↓
deterministic grouping
        ↓
semantic projection
```

Projection may omit from view; it may never omit from evidence.

---

# Transition procedure for a future minor

Before changing `0.x.y → 0.(x+1).0`:

1. Name the new capability in one sentence.
2. Write explicit gates that would falsify the claim if unfinished.
3. Map those gates to existing TODO/readiness tasks where possible.
4. Identify non-gates so scope cannot expand indefinitely.
5. Execute at least one real acceptance scenario.
6. Preserve durable evidence for that acceptance.
7. Confirm no known red blocker directly contradicts the capability claim.
8. Update `STATUS`, `TODO`, readiness/release-target metadata and user-facing version surfaces together.
9. Only then cut the new minor version.

A minor version must therefore be explainable as an evidence-backed capability transition, not as a ceremonial renumbering.

---

# Current interpretation at `0.1.39`

The project has crossed the point where `0.1.x` means “small browser extension prototype”.
It already contains substantial Observer, lifecycle, gateway, knowledge and local-executor infrastructure.

However, the `0.2.0` capability claim is not yet satisfied because routine work still uses RDC on the critical path and the local execution boundary remains incomplete.

The shortest credible route to `0.2.0` is therefore:

```text
late 0.1.x
   │
   ├─ finish/live-accept local execution path
   ├─ remove RDC from routine execution
   ├─ establish minimum bounded execution policy
   ├─ finish Observer acceptance needed to explain the run
   └─ complete one real owner task end to end through EDH
        │
        ▼
      0.2.0
```

This deliberately narrows the transition. Public distribution, full portability and later federation remain later capability milestones rather than reasons to postpone `0.2.0` indefinitely.
