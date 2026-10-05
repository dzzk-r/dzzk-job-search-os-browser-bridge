# Local stack inventory and second-install onboarding draft

Status: **draft / descriptive only**. This document records the current owner-local installation so a future second-machine / clean-profile onboarding path can be designed without reverse-engineering the first installation. It is not yet an installer specification and does not authorize changing the current machine.

## 1. Scope and invariants

The owner-local stack currently combines source code, browser adapters, a loopback companion, ChatGPT Desktop/Codex plugin state, local execution, local model inference, observer state and durable run/knowledge artifacts.

A future onboarding flow must preserve these invariants:

- the Git repository is source-of-truth for code and durable project documentation;
- machine-local secrets are generated locally and are never copied into Git, docs, screenshots or onboarding bundles;
- browser page access remains explicit and revocable per page;
- local execution remains separately authorized from browser read access;
- a fresh installation must not silently inherit another machine's OAuth clients, pairing token, browser grants, process IDs or runtime cache;
- runtime state and caches are reconstructable or disposable unless explicitly documented as durable evidence;
- model/runtime profiles are portable configuration, not hard-coded assumptions;
- Observer state is evidence/projection, not the authority that invents task or correlation identity.

## 2. Current source tree and Git layout

Observed 2026-10-05:

- canonical repository: `~/WORK/execution-delivery-harness`
- active execution worktree: `~/WORK/_bridge-local-execution`
- active branch: `chore/local-execution`
- observed HEAD while this inventory was written: `f9a5091`
- GitHub origin: `dzzk-r/execution-delivery-harness`

The active worktree currently contains substantial uncommitted project work. A second installation must consume a deliberate released/committed revision, not copy this worktree byte-for-byte.

Important repo areas:

- `chrome/` — Chromium/Chrome Browser Bridge and Side Panel Observer.
- `firefox/` — Firefox adapter.
- `server/` — loopback companion and bounded local executor.
- `scripts/` — planner, worker, observer, gateway, lifecycle, knowledge and validation scripts.
- `plugins/local-shared-browser-pages/` — repo copy of the ChatGPT Desktop/Codex local browser facade.
- `docs/` — architecture, policy, operations and validation documentation.
- `knowledge/` — durable machine-readable engineering knowledge.
- `evidence/` — durable acceptance/failure evidence.
- `project/` — aggregate project/readiness state.
- `runs/` — local runtime provenance/examples used during development and acceptance; bulk run directories are not committed. Commit-worthy acceptance is distilled into `evidence/`.

## 3. Browser extension installation

Current Chrome path is an unpacked Manifest V3 extension loaded from:

`~/WORK/_bridge-local-execution/chrome`

Relevant manifest facts:

- name: Execution Delivery Harness Browser Bridge
- version: 0.1.1
- permissions: `activeTab`, `scripting`, `storage`, `alarms`, `sidePanel`
- loopback host permission: `http://127.0.0.1/*`
- fixed companion CSP destination: `http://127.0.0.1:43119`
- Side Panel entry: `observer.html`
- options page: `options.html`

Current development installation requires manual Reload when browser-side HTML/JS/CSS changes. A future packaged/signed distribution should replace this with versioned extension updates and migration-aware local state.

A second installation must explicitly establish:

1. extension installation/package source;
2. companion endpoint;
3. one-time pairing;
4. explicit browser grants;
5. whether Observer is enabled;
6. whether local execution controls are exposed.

Browser grants themselves are ephemeral and must **not** be migrated.

## 4. Loopback companion

Current companion endpoint:

`http://127.0.0.1:43119`

Observed live process:

`node server/index.mjs`

The companion owns or fronts:

- browser-read MCP;
- browser extension pairing and client authorization;
- per-client permission policy;
- Observer snapshot delivery;
- local executor policy boundary;
- correlation/event emission for Harness-owned activity.

Current machine-local config directory:

`~/.config/dzzk-jso-bridge/`

Observed files:

- `pairing-token` — secret; generate locally on each installation; never migrate as documentation.
- `clients.json` — authorized OAuth/MCP client registry; machine/runtime-specific.
- `companion.log` — operational log.

A fresh installation should create this directory with restrictive permissions and generate a new pairing token. Client registrations should be recreated through normal authorization instead of copied by default.

Port 43119 is currently a convention and implementation dependency. Future onboarding should either reserve/check it or support explicit configured port discovery.

## 5. ChatGPT Desktop / Codex local plugin

Current installed personal plugin source:

`~/.codex/plugins/local-shared-browser-pages/`

Observed plugin files:

- `.codex-plugin/plugin.json`
- `.mcp.json`
- `server.mjs`
- `APP-REGISTRATION.md`

Observed plugin version: `0.1.2`.

The installed plugin currently launches a local STDIO MCP facade:

`node ./server.mjs`

The facade then talks to the loopback Browser Bridge companion. This transport is distinct from the HTTP MCP endpoint and therefore must preserve its own correlation/provenance emission.

Personal plugin marketplace metadata currently exists under:

`~/.agents/plugins/marketplace.json`

with marketplace name:

`local-shared-pages-personal`

and plugin:

`local-shared-browser-pages`.

ChatGPT/Codex config enables:

`local-shared-browser-pages@local-shared-pages-personal`

Plugin cache also exists under:

`~/.codex/plugins/cache/local-shared-pages-personal/local-shared-browser-pages/`

The cache is **not** source-of-truth and must not be treated as an installation input.

A future second-install flow needs a supported way to install/register the local plugin from a released bundle or marketplace source rather than manually reconstructing `~/.codex` state.

## 6. Local execution and authorization boundary

The companion's full MCP can expose bounded local tools:

- `local_status`
- `local_list_dir`
- `local_read_file`
- `local_write_file`
- `local_exec_start`
- `local_process_output`
- `local_process_stop`

Local executor operations are blocked by default for a newly authorized client. The current executor trusts shell execution inside configured allowed roots; this is not a filesystem sandbox.

Default owner-local allowed root is effectively the user's `~/WORK` tree unless explicitly overridden.

A second installation must not infer local execution permission from browser-read permission. It must separately establish:

- allowed roots;
- per-client local tool policy;
- whether write is allowed;
- whether process launch/stop is allowed;
- escalation/approval mode.

## 7. Planner / worker / model runtime

Current owner-local profile:

- planner/worker model family: Qwen3.8-27B
- local inference server: llama.cpp
- endpoint: `http://127.0.0.1:8080`
- alias: `qwen3.8-27b`
- observed model file:
  `~/models/Qwen3.8-27B/Qwen3.8-27B-UD-Q5_K_XL.gguf`
- observed llama.cpp process uses 65,536 context and GPU offload.
- observed OpenCode CLI: 1.14.48
- observed OpenCode service: `opencode serve --hostname 127.0.0.1 --port 4096`
- observed ChatGPT bundled Codex CLI: 0.160.0
- observed Node: v26.3.1
- observed npm: 11.16.0

These are the current owner's runtime choices, not universal onboarding requirements.

A portable onboarding profile should separate:

- executor: OpenCode or another worker host;
- provider: llama.cpp / API / other;
- model ID and model path;
- endpoint/port;
- context/token budgets;
- planner budget;
- worker budget;
- verifier policy;
- fallback/escalation policy.

A second installation should validate compatibility before marking the profile ready.

## 8. Detached Harness runs and process ownership

Detached Harness execution is implemented by:

`scripts/run-detached-gateway.mjs`

Machine-global detached state currently lives at:

`~/.local/state/execution-delivery-harness/detached-run.json`

Per-run state/artifacts live below a run directory, currently commonly under:

`~/WORK/browser-bridge-runs/`

A detached run records controller identity, ownership, mode, PID, run directory, context/task paths, heartbeat and terminal state.

Important onboarding distinction:

- global detached state is runtime state and should not be copied to a new machine;
- completed run directories may be durable evidence and should be migrated only through an explicit evidence/archive strategy;
- PIDs, heartbeat timestamps and machine-local paths are never portable identity.

## 9. Observer and event plane

The Side Panel Observer currently projects:

- MCP activity;
- Remote Desktop activity seen through current external instrumentation;
- TERM/process lifecycle;
- OpenCode activity;
- Qwen activity;
- llama.cpp request state;
- Git working-tree delta;
- task lifecycle;
- detached run ownership;
- correlation/span provenance where available.

Observer is a projection of recorded state. It must fail open/degraded rather than redefine task truth when one malformed event cannot be parsed.

Current known architectural gap:

ChatGPT Web turn identity and direct external RDC/MCP activity are not yet authoritatively rooted in the Harness gateway. This is tracked in GW-01/GW-02 work.

## 10. Knowledge, evidence and project state

Durable project knowledge should survive model/runtime replacement.

Current design:

- `knowledge/events.jsonl` — append-only chronology;
- `knowledge/records/*.json` — curated claims/constraints/decisions/lessons/evidence;
- run-local `knowledge-context.json` — exact retrieved context used by a planner;
- `planning-context.json` — reconstructable project/task/readiness context used by planner runs;
- `evidence/` — acceptance and failure evidence;
- `project/readiness.json` — aggregate project/readiness snapshot.

A second installation should migrate Git-tracked durable knowledge/evidence with the repository. Machine-local run caches should not be silently promoted to durable knowledge.

## 11. Secret and identity inventory

Secrets/credentials exist, but their values must not be documented.

Known classes:

- Browser Bridge pairing token;
- MCP/OAuth client registrations and access tokens;
- ChatGPT/Codex plugin installation/account state;
- any external provider credentials introduced later.

Future onboarding must define each item as one of:

- regenerate locally;
- reauthorize interactively;
- import through an explicit secure secret-transfer mechanism;
- never migrate.

Current pairing and OAuth material should default to **regenerate/reauthorize**.

## 12. Current ports and local services

Observed owner-local endpoints:

- `127.0.0.1:43119` — Browser Bridge companion.
- `127.0.0.1:8080` — llama.cpp inference server.
- `127.0.0.1:4096` — OpenCode service.

Future onboarding needs collision checks, health checks and explicit startup ownership. Today these services are already-running local processes; the Harness does not yet own a complete service manager.

## 13. What is source-of-truth vs disposable state

### Source-of-truth / durable

- released Git revision;
- docs;
- tests;
- knowledge records;
- accepted evidence;
- declared runtime profile;
- task/contract schemas.

### Recreated per installation

- extension installation;
- pairing token;
- authorized clients;
- OAuth tokens;
- plugin registration/cache;
- process PIDs;
- active browser grants;
- current detached runtime state.

### Potentially migratable but needs policy

- completed run directories;
- model files;
- local inference configuration;
- OpenCode configuration;
- historical operational logs.

## 14. Draft second-install onboarding phases

A future implementation should be able to execute and verify these phases independently:

1. **Host preflight** — OS/architecture, Node/npm, Git, free ports, filesystem permissions.
2. **Repo install** — clone released revision, install npm dependencies, verify tests.
3. **Companion bootstrap** — generate local config/secrets, start companion, health check.
4. **Browser adapter install** — install signed/unpacked build, pair with companion, verify no grants exist initially.
5. **ChatGPT/Codex plugin install** — install local plugin, verify tool discovery, authorize explicitly.
6. **Browser-read acceptance** — share one disposable page, `list_tabs`, `read_page`, revoke.
7. **Local executor policy setup** — configure allowed roots and per-client policy; verify read-only first.
8. **Model runtime setup** — detect/configure llama.cpp/OpenCode/profile; run bounded inference smoke.
9. **Harness execution acceptance** — prepared task -> detached run -> worker -> verifier -> terminal state.
10. **Observer acceptance** — prove correlation, lifecycle, actor state, degraded/offline semantics.
11. **Knowledge/evidence bootstrap** — verify durable context retrieval without importing transient runtime state.
12. **Recovery test** — restart companion/browser/ChatGPT and prove state that should persist does persist, while ephemeral grants do not.

Each phase should emit machine-readable readiness evidence and be resumable.

## 15. Installation manifest we will eventually need

A future installer should be driven by a declarative manifest rather than hard-coded owner paths. Candidate fields:

- install/repo revision;
- companion host/port;
- browser adapters to install;
- plugin source/version;
- allowed local roots;
- executor profile;
- model endpoint/model ID/model path;
- knowledge/evidence locations;
- service startup policy;
- required/optional acceptance checks.

The manifest must not contain secrets.

## 16. Current blockers before a credible second-install experience

- no released/signed Chrome package and automatic update path;
- no single service manager for companion/OpenCode/llama.cpp;
- no declarative owner-local runtime profile;
- no supported one-command plugin installation path;
- no prepared-task dispatch UI yet;
- no generic verifier lifecycle yet;
- GW-01 authoritative ChatGPT turn/tool gateway is incomplete;
- GW-02 detached execution exists, but general lifecycle controls are incomplete;
- path assumptions still reference the current owner layout;
- migration policy for completed runs/model files is not yet defined.

## 17. Definition of “second installation ready”

Do not call onboarding ready until a clean user/profile/machine can, from documented inputs only:

- install a released Harness revision;
- start required local services;
- pair a browser extension without copying secrets;
- install/authorize the ChatGPT Desktop plugin;
- share and read one browser page;
- authorize a bounded local root;
- prepare and dispatch one Harness task;
- observe one correlated planner/worker/verifier lifecycle;
- restart components and recover expected durable state;
- remove/uninstall the stack without leaving active credentials or orphaned background processes.

Until then this document is an inventory and implementation backlog, not a product installation guide.
