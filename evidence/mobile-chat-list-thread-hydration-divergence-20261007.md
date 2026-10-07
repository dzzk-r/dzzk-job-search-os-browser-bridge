# Mobile ChatGPT conversation-list / opened-thread hydration divergence — 2026-10-07

Status: observed evidence, cause not established  
Context: Execution Delivery Harness project, Android ChatGPT client

## Observation

At approximately 12:56–12:58 local time, the Android ChatGPT project view and the opened conversation exposed inconsistent freshness.

The project chat list showed a recent preview for:

- `Проверка HEAD и плагин 2 / продолжение live acceptance`

with a newer message snippet visible before opening the conversation.

After entering the conversation, the thread initially presented an older/hydrated state rather than the same freshest state implied by the chat-list preview. A subsequent screenshot from inside the project shows the conversation open and the branch marker:

- `Branched from Проверка HEAD и плагин 2 / продолжение live acceptance`

The screenshot was supplied directly in the ChatGPT conversation at 12:58 on 2026-10-07.

## What this evidence establishes

This establishes an observable UI/state divergence between:

1. conversation-list metadata / latest-message preview, and
2. opened-thread hydration/render state.

It does **not** establish the root cause.

Plausible classes of cause include client cache/hydration, pagination/state restore, branch/conversation identity handling, or a mobile-client synchronization defect. These are hypotheses only.

## EDH implication

Do not treat the mobile ChatGPT client's rendered thread state as an authoritative persistence or continuity boundary.

For cross-device continuity, EDH should continue to rely on explicit conversation identity, ledger evidence, gateway state and durable artifacts rather than assuming that the client UI's opened-thread hydration is complete or current.

## Reproduction signal

A useful future repro is:

1. observe a visibly fresh latest-message snippet in the project chat list;
2. open that same conversation;
3. compare the newest rendered message/branch state against the list preview;
4. record app version, timestamp and whether a manual refresh/app restart changes the opened-thread state.


## Additional app-freshness evidence — 13:00

A subsequent Google Play screenshot at approximately 13:00 shows **ChatGPT — 863 MB — Updated yesterday** in the device's recently-updated apps list.

This weakens the explanation that the observed list/thread divergence was simply caused by a long-stale Android ChatGPT installation. It does **not** establish the exact installed version/build, and it does not by itself prove that no newer update is currently pending because the screenshot is from the recently-updated view rather than an expanded ChatGPT entry under `Updates available`.

## Exact Android client version — 13:02

A subsequent Android App info screenshot identifies the installed ChatGPT application as:

- **Version:** `1.2026.272`
- **Storage footprint shown:** `863 MB`
- **Network data usage shown:** `455.2 MB`
- **Battery usage shown:** `65.8%`
- **Pause app activity if unused:** enabled

The exact installed app version is therefore known. This further weakens a generic "very stale client" explanation for the observed conversation-list / opened-thread freshness divergence.

The `Pause app activity if unused` setting is present, but the same screen shows substantial recent network and battery usage, so there is no evidence here that the app was merely dormant or unused when the divergence occurred.

ADB was not connected at the time of this check, so Android package-manager `versionCode` and update timestamps were not independently captured from `dumpsys package`.
