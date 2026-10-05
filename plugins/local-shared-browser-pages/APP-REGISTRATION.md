# ChatGPT app registration

This facade intentionally exposes only four read-only browser tools: `bridge_status`, `list_tabs`, `read_page`, and `find_in_page`.

Do not include internal project names, architecture, planner/worker details, observer/timeline internals, local execution, model routing, or run/evidence internals in ChatGPT app metadata.

When ChatGPT issues the real App SDK identifier, add `.app.json` and reference it from `.codex-plugin/plugin.json` with `"apps": "./.app.json"`. Never invent an `asdk_app_...` id.
