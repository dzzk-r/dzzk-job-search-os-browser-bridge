# Finite local execution

Routine coding and checks belong to local Qwen. ChatGPT is reserved for a narrow
decision supported by concrete risk, contradictory evidence or an unresolved
failure after one bounded repair. The target is roughly 90% local work and 10%
escalation, not a measured or enforced billing limit. See `AGENTS.md` for scope,
logging and STOP requirements. These rules do not yet implement a complete
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
