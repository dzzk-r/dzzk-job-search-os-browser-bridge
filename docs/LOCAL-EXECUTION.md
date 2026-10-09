# Finite local execution

## Current execution policy

- Routing target: roughly 90% routine bounded local work and 10% ChatGPT
  supervision/escalation. This is an operating target, not proof that routing is
  automated today.
- Current local profile: OpenCode 1.14.48 -> Qwen3.8-27B -> llama.cpp at
  loopback. Treat this as an owner profile, not a universal user requirement.
- Current wrapper policy: task text limited to 3,000 chars, steps to 1..6 with
  default steps=4, and tokens to 2,048. These are wrapper policy limits, not
  model or runtime capabilities.
- Live evidence: a 4-step run exhausted before completing a Help task; a later
  6-step run also exhausted after code edits but before its required test. Fixed
  step count is therefore too coarse to use as completion truth; acceptance
  criteria remain authoritative.
- `max_steps` exhaustion must make the semantic result failed even when the
  process exit code is 0 and the expected file changed.
- Future portable execution profiles should define executor/provider/model/
  runtime/budgets/permissions/acceptance separately. User authorization remains
  explicit.
- First self-hosting UI dogfood on 2026-10-09 exposed a local-worker efficiency problem: a four-file bounded task hit its 420 s deadline with zero edits, and a CSS-only repair hit `max_steps_reached` after 194.9 s with zero edits. In both attempts OpenCode/Qwen first attempted a repository-root read that the scoped policy correctly denied. Treat this as executor evidence, not a reason to weaken scope: improve bounded-worker instructions/context selection before raising budgets.

Routine coding and checks belong to a bounded local worker. The worker task
should normally be emitted by the local planner contract in
`docs/LOCAL-PLANNING.md`, rather than hand-authored by ChatGPT. ChatGPT is
reserved for a narrow decision supported by a valid escalation packet: concrete
risk, contradictory evidence, architectural/policy ambiguity, a user decision,
or unresolved failure after the permitted bounded repair. See `AGENTS.md` for
scope, logging and STOP requirements. These rules do not yet implement a complete
autonomous OpenCode executor.

The runner `scripts/local-check.py` performs npm tests, Firefox extension linting
and packaging on the owner's computer. It uses no paid model API. With `--review`,
it sends source code to an existing loopback llama.cpp server once, after checks
pass. It does not apply model output, commit, reset Git, launch or stop a model,
or access personal browser pages.

Run in an isolated worktree through the existing observer:

```sh
python3 /Users/dzzk/WORK/job-search-os/scripts/asdlc/run_observed.py --repo-status -- python3 scripts/local-check.py --review --review-input artifacts/local-check/policy-review.txt
```

The observed Qwen server has alias `qwen3.8-27b` at `http://127.0.0.1:8080`.
The runner also accepts MODEL and LLAMA_CPP_URL. It skips review when the server
slot is busy; it does not restart Qwen or load Gemma alongside it. Gemma remains
a separate second-review stage, not a claimed result of this run.

Prepare the UTF-8 excerpt explicitly. With `--review`, missing input, a path
outside the repo (including a symlink escape), blank input, invalid UTF-8 or
input over 8,000 characters is rejected before checks or model requests. Source
files are never collected automatically and input is never silently truncated.

Limits: one model request, 400 output tokens including the server's reasoning
allocation, 8,000 source characters, 120-second HTTP timeout, and explicit command
timeouts. No automatic retry. Creating artifacts/local-check/STOP stops further
steps and terminates this runner's active test subprocess group. An already sent
model request may continue until its response or timeout; STOP does not stop the
shared llama.cpp server.

Each run writes command logs, exact request JSON, model input/response and report.json under ignored
artifacts/local-check. The report includes Git HEAD, full untracked status and a
hash of tracked files before/after, input hash, elapsed request time and returned
usage. Only nonempty content with `finish_reason: stop` completes the review.
Empty or malformed responses fail; truncated responses are incomplete. A requested
review that does not complete exits nonzero, even when `checks_passed` is true.
Validate runner changes with `python3 -m unittest discover -s tests -p test_local_check.py`.
Passing local checks does not establish live
ChatGPT linking, live LinkedIn extraction, AMO signing or public approval.
