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

## Package-manager confirmation via active Wireless ADB — 2026-10-08

Mac-to-phone Wireless ADB was already active through Android's modern mDNS/TLS transport. `adb devices -l` showed the Xiaomi 12T Pro as an attached device:

- product: `ditingp_global`
- model: `22081212UG`
- device: `diting`
- transport: `_adb-tls-connect._tcp`

Using that active connection, Android package-manager metadata for `com.openai.chatgpt` was read directly from the phone:

- `versionName=1.2026.272`
- `versionCode=2627220`
- `firstInstallTime=2023-08-01 01:29:49`
- `lastUpdateTime=2026-10-06 04:42:34`

The user explicitly states that they did not manually update ChatGPT yesterday or during the preceding week. The package-manager timestamp therefore strongly supports that the installed ChatGPT package was updated automatically/background-managed rather than by a manual update action immediately before the observed divergence.

This materially strengthens the evidence chain around the conversation-list / opened-thread freshness divergence:

1. the Android client was not broadly stale;
2. its exact installed build is known (`1.2026.272`, versionCode `2627220`);
3. that package was updated on 2026-10-06 at 04:42:34;
4. the list/thread divergence was observed shortly after that update window.

This does **not** prove that `1.2026.272` caused the divergence. It makes a client regression, cache/schema migration issue, branch-state migration issue, or post-update hydration inconsistency more plausible classes of explanation that deserve targeted reproduction.

### Wireless ADB transport note

Android's Wireless debugging UI showed a dynamic endpoint (`192.168.88.216:41879`) and paired Mac entries marked `Currently connected`. A direct `adb connect 192.168.88.216:41879` attempt returned `Connection refused`, while the existing `_adb-tls-connect._tcp` device session remained attached and usable. This is consistent with modern Wireless ADB service discovery / rotating dynamic endpoints and should not be interpreted as loss of the existing paired transport.
