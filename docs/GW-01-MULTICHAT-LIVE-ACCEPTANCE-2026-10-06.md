# GW-01 / multi-chat live acceptance — 2026-10-06

Status: PARTIAL ACCEPTANCE. Do not mark GW-01 closed.

## What was accepted live

The GW-01 multi-chat/admission delta from experiment branch `exp/gw01-multichat` through commit `250054b` was applied cleanly to the dirty live worktree `chore/local-execution` after `git apply --check` passed.

Targeted acceptance after applying the delta:

- 44 tests
- 44 pass
- 0 fail
- `git diff --check`: clean

Coverage includes:

- distinct conversation bindings for two ChatGPT tabs;
- binding persistence across extension reload state;
- binding revocation after navigation;
- only an explicitly bound active ChatGPT tab may be reported as current;
- admitted turns preserve one stable conversation root while allocating distinct turn roots;
- cross-chat rebinding is rejected before dispatch;
- platform locator remains optional evidence and is not conversation identity;
- interleaved multi-chat events project into Current chat / Other chats / Unscoped without changing the global ledger;
- unscoped evidence is never inferred into a conversation by focus or timestamp;
- prepared dispatch rejects conversation-binding conflicts before execution.

## Live runtime evidence

The existing gateway process was first probed as a baseline. It returned:

- health: OK;
- Chrome adapter: connected;
- sharedTabs: 0;
- mode: read-only;
- GW-01 correlation acceptance: PASS;
- baseline correlation: `corr:364755a3-56d8-4a5c-b6ce-109156e82810`;
- source quality: `declared`.

The gateway was then restarted from the updated live worktree while preserving the persisted pairing token. Chrome reconnected automatically. The same live acceptance returned:

- health: OK;
- Chrome adapter: connected;
- sharedTabs: 0;
- mode: read-only;
- correlation: `corr:2e8db5eb-78e7-45e1-a4f8-58b8d87a1ab3`;
- action-before-MCP ordering: 1 ms;
- MCP duration: 378 ms;
- source quality: `declared`.

The durable prepared-dispatch state also survived gateway restart and remained `DISPATCHED` for task `GW-02-PREPARED-DISPATCH-ACCEPT`.

## Explicitly not accepted / remaining gate

This does **not** close GW-01 transport identity.

The live GW-01 acceptance endpoint still creates a declared synthetic CHAT/ACTION root. Its source has no transport-observed ChatGPT `conversation_id` / `message_id`. Platform-managed ChatGPT Web → MCP/RDC calls still arrive at the gateway with `conversation_id=null`, so automatic authoritative admission at the real client/tool boundary is still missing.

The new extension code contains explicit ChatGPT-tab binding and chat-scoped Observer projection, but this run did not prove the new side-panel UI after an unpacked-extension reload. Until that UI/runtime reload is observed, treat the multi-chat UI portion as code/test accepted, not live-UI accepted.

## Verdict

Accepted:
- GW-01 conversation admission contract;
- multi-chat isolation/projection semantics;
- conflict rejection before prepared dispatch;
- deployment of the delta into the live worktree;
- gateway restart/reconnect compatibility.

Still open:
- transport-observed ChatGPT conversation/message identity at MCP gateway entry;
- automatic client/tool dispatch admission using that identity;
- live side-panel reload acceptance for Current chat / Other chats / Unscoped / All activity.
