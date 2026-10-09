# Unified reactive state plane

Status: **0.1.46 baseline**

The Side Panel must render one coherent EDH control-plane state rather than let
individual cards fetch companion fragments independently.

## Problem fixed in 0.1.46

Before this baseline, one Side Panel refresh performed separate companion reads
for observer, project tasks, RDC intents, prepared dispatch and executor policy.
At a 1.5 second refresh cadence that alone approached 200 `/bridge/*` requests
per minute before normal CHAT observation ingress was counted. The companion
rate limit is 240 bridge requests per 60 seconds, so active ChatGPT work could
self-throttle the UI.

The same design also allowed a rendered frame to combine fragments observed at
different moments.

## Canonical companion snapshot

The companion now exposes one pairing-protected read:

```text
GET /bridge/dashboard-state?adapter=chrome
```

The response contains one revisioned snapshot:

```text
revision
generated_at
observer
project_tasks
rdc
prepared_dispatch
executor_policy
```

The revision advances when the canonical snapshot content changes.

Legacy fragment endpoints remain available for compatibility and focused tests,
but the Side Panel steady-state render path does not use them.

## Background-owned client state

Chrome background owns synchronization with the companion.

It maintains:

- one cached dashboard snapshot;
- one in-flight dashboard fetch at a time;
- a minimum 2 second companion fetch interval;
- explicit cache invalidation after control mutations;
- throttling/backoff state.

All Side Panel cards are rendered from the single `dashboard-state` value
returned by the background. Multiple UI consumers therefore share the same
cache/in-flight request instead of multiplying companion traffic.

This is intentionally a store/cache architecture without introducing React or
another UI framework. Transport and view framework remain replaceable details.

## View rule

Steady-state Side Panel code must not directly request these companion fragments:

```text
observer-state
project-tasks
rdc-intents
dispatch-state
executor-policy
```

It requests only `dashboard-state` from the extension background, then renders
selectors/projections from that state.

Control mutations remain explicit actions (`Take`, `Release`, executor policy,
dispatch, etc.). Successful mutations invalidate the background dashboard cache
so the next read observes fresh control-plane state.

## Single-flight refresh

Side Panel refresh is self-scheduled:

```text
refresh
  -> await completion
  -> schedule next refresh
```

It does not use an overlapping `setInterval` loop. Background dashboard fetches
also use one shared in-flight promise.

## Backpressure and 429

A bridge rate-limit response now includes `Retry-After`.

When dashboard synchronization receives HTTP 429:

- background keeps the last successful dashboard snapshot;
- connection state becomes `THROTTLED`, not `OFFLINE`;
- retry delay uses `Retry-After` or exponential backoff up to 30 seconds;
- Side Panel continues rendering the cached companion state;
- browser-local CHAT activity remains available and can still be shown.

An actual non-rate-limit connection failure may be represented as `OFFLINE`,
while preserving cached state when available.

## Request-budget estimate

With one open Side Panel during an active ChatGPT turn, expected baseline bridge
traffic after this change is approximately:

```text
dashboard snapshot        <= 30/min
background /next             60/min
active conversation         <=12/min
chat tab inventory             2/min
turn detector active         ~20/min
------------------------------------
expected baseline           ~124/min
bridge limit                 240/min
baseline utilization         ~52%
```

START/DONE events and explicit user actions add burst traffic, so this is a
budget estimate rather than a hard upper bound. It restores meaningful headroom
without raising the rate limit.

## Remaining work

0.1.46 deliberately does not add WebSocket/SSE/long-poll transport. The state
plane makes that a transport substitution rather than another UI refactor.

Still useful future improvements:

- split read/observation/control rate-limit classes so evidence ingress and
  mutations cannot compete with dashboard reads;
- revision-aware delta delivery;
- background push/subscription to Side Panel rather than UI-triggered cached
  reads;
- long-poll or stream transport;
- self-observability for request rate, headroom, 429 count and snapshot latency.
