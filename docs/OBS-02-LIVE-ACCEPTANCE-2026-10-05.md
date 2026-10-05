# OBS-02 live acceptance — 2026-10-05

OBS-02 (actor activity truth and local-agent lifecycle visibility) is accepted from one real bounded OpenCode worker run.

Canonical evidence: `evidence/obs-02-worker-live-20261005.json`.

The accepted run used one correlation ID across the Harness-owned lifecycle skeleton:

```text
corr:30b0bf97-d535-4f6b-a41a-43f9df816d01

TERM
└─ OC
   └─ QWEN
      └─ LLAMA
```

During live inference, TERM/OC/QWEN/LLAMA were all RUNNING on the same correlation. The run then terminated on the failure path and all four spans closed ERROR with the same correlation; after termination all actor-activity flags returned false.

The worker nevertheless created the only allowed artifact, `artifacts/observer-worker-acceptance.txt`, containing `OBSERVER_WORKER_ACCEPTANCE=PASS`.

This closes OBS-02 because actor activity, parent/child lifecycle, terminal state and idle-after-terminal behavior were all observed on a real OpenCode/Qwen/llama.cpp worker, not a mocked planner test.

## Explicitly not closed by this evidence

OBS-04 / GW-01 remain open. Detailed OpenCode events such as read/write completion, step-finish events and some model-detail events are still reconstructed from secondary logs and can carry `correlation=null`. Transport-observed ChatGPT conversation/turn/message identity is not yet allocated at the MCP gateway boundary.

PL-03 also remains open. This run exposed a verifier/outcome-semantics issue: the allowed artifact satisfied the task acceptance marker, while the wrapper still reported `worker_failed` because `max_steps_reached` occurred after the useful edit. Semantic acceptance must be evaluated by a Harness-owned verifier rather than inferred solely from worker termination reason.
