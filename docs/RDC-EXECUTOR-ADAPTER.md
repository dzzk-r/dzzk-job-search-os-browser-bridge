# RDC executor adapter

Status: **0.1.45 control-plane bridge**

Remote Desktop Commander is treated as an external execution backend, not as an
unbounded authority automatically inherited by EDH.

## Authority split

EDH owns:

- the admitted Task and bounded task envelope;
- executor selection (`RDC`);
- Run and correlation identity allocated before execution;
- the capability set derived from Task scope;
- declared read/write scope;
- lifecycle state for the RDC intent;
- tool-call evidence reported under that intent;
- terminal result, artifacts and comparison metrics.

The ChatGPT/RDC platform owns:

- the external permission prompt shown to the user;
- the remote transport/session;
- actual device connectivity;
- the physical RDC tool invocation.

EDH must not claim that it bypasses or replaces the platform permission boundary.
A successful RDC adapter execution therefore requires both:

```text
EDH intent/capability authorization
AND
external ChatGPT/RDC platform approval
```

## Intent lifecycle

```text
AWAITING_CLAIM
  -> CLAIMED
  -> approval APPROVED
  -> RUNNING
  -> DONE / ERROR / CANCELED
```

A denied external approval terminates the intent as `DENIED`.

The intent allocates before execution:

- `intent_id`;
- `run_id`;
- `correlation_id`;
- parent RDC executor span;
- `task_id` / `plan_id`;
- baseline commit;
- ChatGPT conversation/turn identity when known.

## Capability minimization

RDC exposes many tools. EDH does not automatically grant all of them.

The adapter maps the bounded Task `scope.tools` into an explicit `rdc_tools` set.
For repository work the currently modeled subset covers:

- `read_file`, `read_multiple_files`, `list_directory`;
- `write_file`, `edit_block`, `create_directory`;
- `start_process`, `read_process_output`, `interact_with_process`,
  `force_terminate` when execution/process capability is declared.

The intent also preserves declared reads/writes from the Task envelope. A tool
outside `rdc_tools` is rejected by the adapter contract even if the external RDC
platform would technically allow it.

The current platform approval can still be broader than the EDH Task envelope.
This gap is explicitly recorded as:

```text
platform_permission_can_be_broader_than_edh_intent
```

The long-term goal is to reduce or eliminate that gap by configuring/using RDC
through a narrower adapter/backend profile where possible.

## Local adapter client

`scripts/rdc-intent-client.mjs` provides a local helper for an external ChatGPT
session that is already using RDC. It reads the machine-local EDH pairing token
without printing it and can report intent lifecycle transitions back to the
companion.

Examples:

```sh
npm run rdc:intent -- list
npm run rdc:intent -- claim <intent_id> <device_id>
npm run rdc:intent -- approve <intent_id>
npm run rdc:intent -- start <intent_id> <device_id>
npm run rdc:intent -- tool <intent_id> start_process START <call_id>
npm run rdc:intent -- tool <intent_id> start_process DONE <call_id> <pid> <duration_ms>
npm run rdc:intent -- complete <intent_id> PASS 0 <artifact>...
```

The `approve` transition does not create platform permission. It records that the
external platform/user approval boundary has already succeeded. If the user
rejects that platform prompt, the adapter must report `deny` instead.

## Observer behavior

The Side Panel `Run -> Execution & ownership` area shows the latest RDC intent:

- intent/run/task identity;
- lifecycle status;
- external approval state;
- device identity when known;
- allowed RDC tools;
- declared read/write scope;
- tool-call/error counts;
- terminal outcome.

RDC intent and tool lifecycle events use the same `run_id` and `correlation_id`,
so they can participate in Task/Run/Span/Timeline causality instead of being
reconstructed only from timing.

## What 0.1.45 does not yet do

- The companion cannot directly invoke the platform-managed ChatGPT RDC tool.
- Existing ordinary ChatGPT -> RDC calls can still bypass EDH if the operator
  invokes them without first creating/claiming an EDH RDC intent.
- COMPARE does not yet automatically create isolated worktrees, execute both
  backends, verify both and compute a winner.
- The RDC platform permission prompt may describe a broader capability than the
  bounded EDH intent.

Therefore 0.1.45 establishes an authoritative **EDH execution intent and result
contract** for RDC, but full transport authority is not achieved until routine
RDC work enters this contract before substantive execution.
