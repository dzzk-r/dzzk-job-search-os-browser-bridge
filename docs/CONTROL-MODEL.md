# Action controls and Remote Desktop Commander comparison

Checked October 3, 2026. This is a design comparison, not an audit of the hosted
Remote Desktop Commander implementation (its source is not public).

| Layer | Remote Desktop Commander / ChatGPT | Execution Delivery Harness Browser Bridge |
| --- | --- | --- |
| Host approvals | ChatGPT global and per-app preferences decide when to ask before a tool call | Same host controls apply when connected; tool annotations do not override them |
| Service authorization | OAuth authorizes a client; paired devices can be revoked from the dashboard | OAuth client approval and connection revocation in the Firefox popup |
| Stop further access | Stop the device agent or revoke the device | Disconnect/revoke tokens, stop sharing a page, or persistent Pause all actions |
| Per-operation policy | No claim about unpublished hosted policy code | Per-client Allow / Ask every time / Block for all four read operations |

Bridge enforcement lives in the companion before dispatch and before returning
results. Ask holds a request until the extension approves its unique request ID.
Block and Pause are actual service-side refusal, not an instruction to the model.
Changed policies cancel outstanding calls. Firefox also clears its page grants
on pause and persists a local prohibition if the companion cannot be reached.
MCP client credentials cannot change these controls. Previously returned data
cannot be retracted.

Primary sources:

- ChatGPT capability layers: https://learn.chatgpt.com/docs/enterprise/apps-and-connectors
- ChatGPT permission preferences: https://developers.openai.com/plugins/changelog
- Remote Desktop Commander public manifests, service model and device revocation:
  https://github.com/desktop-commander/remote-desktop-commander
