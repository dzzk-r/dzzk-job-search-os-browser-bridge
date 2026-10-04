# Browser Bridge execution rules

## Local execution first

Use the owner's local Qwen via OpenCode for routine implementation, bounded
source review, test execution and ordinary repairs. The observed provider/model
is `llamacpp/qwen3.8-27b`, using the existing llama.cpp server at
`http://127.0.0.1:8080/v1`. Do not restart it or load a second large model beside
it. Check whether the single slot is busy before submitting work.

The user's target is roughly 90% local work and at most 10% ChatGPT escalation
for concrete concerns. This is a routing target, not an enforced billing cap.
An installed executable, successful HTTP response or process exit zero does not
establish task completion. Require the requested artifact and validation.

Escalate a narrow question only when evidence shows a security/access-control
concern, destructive or irreversible action, conflicting evidence, or a failure
remaining after one bounded repair attempt. Missing credentials or a user's
decision require that input; do not send the project through another model audit.
Include the task, relevant diff/excerpt, exact failed command, log path and the
single decision needed. Never resend the whole project by default.

## Scope, evidence and stopping

- Give each local task explicit file permissions, acceptance criteria, command
  and model-output limits, a deadline and a STOP file. Make small edits instead
  of asking for an entire project rewrite. Do not allow uncontrolled retries.
- Work in an isolated checkout. Do not reset, commit, push or change the main
  checkout as part of diagnostics. Keep unrelated projects, especially STERN,
  outside this project's output paths.
- Save each command, timestamp, output and exit code on the Mac as it runs.
  The current evidence directory is
  `/Users/dzzk/WORK/browser-bridge-runs/2026-10-03/`; explain any later path change.
  Read and write only task-relevant files and name the paths to the user.
- Preserve the user's interactive shell. Do not use `set -e`, replace or terminate
  the shell. A diagnostic failure must be recorded without hiding later results.
- A STOP request prevents subsequent work and terminates only the task's own
  subprocesses. Never stop the shared llama.cpp server or the user's OpenCode.
- A review is complete only with nonempty content and `finish_reason: stop`.
  Treat truncated output and claims without evidence as unfinished work.

See `docs/LOCAL-EXECUTION.md` for the finite check/review runner. The complete
autonomous OpenCode executor is not yet implemented; do not claim these rules
provide automatic routing or a working general-purpose agent.
