# Clients and transports

## Purpose

Execution Delivery Harness is not a Chrome extension with ChatGPT-specific logic.
The harness is the user-owned execution boundary. Browser extensions, local
execution and observer surfaces are adapters around that boundary, while MCP is
the client-facing contract.

The target shape is:

```text
                         Execution Delivery Harness
                                   |
                  +----------------+----------------+
                  |                |                |
             Browser Bridge    Local Executor     Observer
                  |                |
          Chrome / Firefox     filesystem
          explicitly shared   terminal / processes
                  |
             MCP boundary
                  |
       +----------+-----------+----------------+----------------+
       |                      |                |                |
 ChatGPT Web          ChatGPT Desktop    OpenAI API      generic MCP host
 remote HTTPS or      local MCP app      Responses API   supported transport
 Secure MCP Tunnel    or remote/tunnel   MCP tool        + compatible auth
```

This is an architectural boundary, not a claim that every path above has already
passed end-to-end validation.

## Client matrix

| Client surface | Transport into the harness | Current state | What must be true |
| --- | --- | --- | --- |
| **ChatGPT Web** | Remote HTTPS MCP endpoint, or OpenAI Secure MCP Tunnel to the private/local companion | **Not yet live-verified** | ChatGPT must be able to discover the MCP tools; private/local companion stays non-public when the secure tunnel path is used |
| **ChatGPT Desktop Codex** | Local personal plugin `Local Shared Browser Pages` via STDIO facade -> loopback companion `/local/browser-call` | **Plugin injection and real `list_tabs` invocation verified; shared-tab acceptance still incomplete** | The Desktop Codex runtime can invoke the four browser-read tools. Its STDIO facade is a distinct transport path and must emit/preserve Harness trace metadata independently of the HTTP MCP path. ChatGPT Classic Desktop still did not inject this plugin in the observed runtime and remains a separate compatibility gap. |
| **OpenAI API** | Responses API MCP tool using `server_url` for a reachable remote MCP server or `tunnel_id` for a private/local server through Secure MCP Tunnel | **Documented target; not yet live-verified** | The selected model/API surface must support MCP; approval/auth policy remains explicit |
| **Generic MCP client** | Whatever MCP transport the client and harness both support; do not assume host-specific discovery or auth | **Protocol direction only; compatibility must be tested per host** | Tool names/contracts stay host-neutral; host-specific auth, approvals and transport live outside browser adapters |

## Boundary rules

The browser extension is an adapter. It owns explicit browser-page grants and
browser-local UI, not the identity of the upstream model or client.

The local executor is an adapter. It exposes bounded filesystem/process
operations through the same policy boundary. Its current trusted-shell execution
mode is not a filesystem sandbox and remains blocked by default for a newly
authorized client.

The Observer watches the harness execution/event plane. A request that originated
from ChatGPT Web, ChatGPT Desktop, the Responses API or another MCP host should be
representable by the same spans and actors. The Observer must not require a
different event model for each client.

The MCP gateway/companion is the client-facing boundary. Client-specific
transport, authentication and approval mechanics terminate there. Browser Bridge,
Local Executor and future adapters must not contain OpenAI-specific branching
unless a concrete interoperability requirement forces it.

## OpenAI-specific transport facts

As checked on 2026-10-04:

- ChatGPT does not directly connect to a loopback/private MCP server. OpenAI
  documents Secure MCP Tunnel for supported OpenAI products when the MCP server
  must remain private.
- Secure MCP Tunnel is outbound-only from the private environment and can be used
  by supported OpenAI surfaces including ChatGPT and the Responses API. It is a
  development/private-connectivity path, not a substitute for the stable public
  HTTPS endpoint required for public plugin submission.
- The Responses API accepts MCP through `server_url` for a reachable remote MCP
  server or `tunnel_id` for a private/local server through Secure MCP Tunnel.
- ChatGPT plugins can include local MCP apps that run on the user's computer in
  ChatGPT Desktop. Those local tools do not thereby become available on ChatGPT
  Web or mobile.

Official references:

- https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- https://developers.openai.com/api/docs/guides/tools-connectors-mcp
- https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt
- https://help.openai.com/en/articles/20001256-plugins-in-chatgpt

These are product capabilities, not evidence that this repository has completed
the corresponding integration.

## Validation order

The same tool contract should survive each client path. The first useful
cross-client acceptance sequence is:

```text
browser grant
  -> list_tabs
  -> read_page

local execution policy grant
  -> local_status
  -> local_list_dir
  -> local_read_file
```

Run that sequence first from ChatGPT Web, then from ChatGPT Desktop, then through
the Responses API. A generic MCP client is a separate compatibility check, not a
reason to fork the tool contract.

A client path is **verified** only after tool discovery, authorization/policy,
one browser read and one bounded local read have all completed through that
client. Documentation or successful local unit tests alone do not mark the path
verified.

## ChatGPT Web browser-observed identity vs transport identity

Chrome can now observe a real ChatGPT Web conversation root directly from the loaded page URL (`/c/<conversation_id>`) and can publish browser-observed chat / turn lifecycle into the common ledger. This is useful evidence and supports named conversation projections in the Side Panel.

It does **not** mean that a platform-managed ChatGPT Web MCP/RDC call carries that conversation ID into the Harness transport. Until the first tool dispatch is causally bound to the browser-observed turn, external calls may remain `Unscoped`. Downstream process ancestry can then be propagated by span identity and PID/process-instance metadata once that first edge is established.
