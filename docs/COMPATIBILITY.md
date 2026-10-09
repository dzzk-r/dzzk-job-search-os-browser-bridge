# Compatibility and cost

Updated: **2026-10-09**
Current development baseline: **0.1.47**

| Component | Current support |
| --- | --- |
| Chrome / Chromium with MV3 Side Panel | Primary owner-local development adapter; unpacked Chrome installation and Side Panel are locally verified |
| Firefox desktop 140+ | Read-only adapter and Observer page exist; historical 0.1.1 synthetic smoke is preserved; current Sidebar parity remains unverified |
| Node.js 22+ | Required local companion runtime |
| ChatGPT Web | Browser conversation/turn observation works; authoritative platform tool-dispatch correlation remains incomplete |
| ChatGPT Desktop / local plugin | Private stdio browser-read facade exists; final live client acceptance remains tracked in CT-03 |
| Generic MCP hosts | Partial compatibility; full host acceptance remains tracked in CT-05 |
| LinkedIn / other ordinary pages | Visible manually shared page text through the generic read path; no messaging/crawling/write guarantee |
| Opera | EDH-specific adapter remains future/unverified; any third-party Opera connector is independent |
| Safari | Not implemented |
| llama.cpp / Qwen | Optional owner-local inference profile; not required for Chrome Side Panel installation |
| OpenCode | Optional agent/worker runtime; not required for Chrome Side Panel installation |
| Ollama | Optional alternative model runtime when selected by an execution profile |

The code is MIT licensed. There is no EDH subscription, required paid browser-automation service or developer-operated relay. Remote MCP/model/hosting providers can have their own plans, billing and availability requirements.

Compatibility names identify integration targets, not ownership or affiliation. AMO publication, Chrome Web Store publication and public ChatGPT distribution are separate release/review tracks.

Current Chrome local installation instructions are in `docs/CHROME-LOCAL-INSTALL.md`.
