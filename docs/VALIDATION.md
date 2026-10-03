# Validation — 0.1.1

Executed October 3, 2026.

- Node.js 24.19.0; MCP SDK 1.32.0; web-ext 10.7.0.
- `npm test`: 21 passing tests. Includes consent, PKCE/replay, audience,
  credential separation, in-flight revocation, hidden/form/draft exclusion and
  page grant expiration/navigation/closure behavior, persisted method blocks,
  pause cancellation, one-use approval, rejection of remote policy changes and
  refusal of pending OAuth grants while paused, local pause after companion
  failure/restart and a newer pause taking precedence over pending resume.
- `npm run lint`: no errors, notices or warnings.
- Real Firefox 157.0 smoke check with a disposable profile: install, settings,
  OAuth approval through packaged extension UI, unshared list empty, browser
  action grant, share, MCP read, literal find, Ask/Allow once, Ask/Deny once,
  Block/refusal, Allow/read, global pause/refusal, resume/old grant refused.
- Synthetic fixture: visible recruiter/job text; hidden text, textarea, input
  and editable draft excluded from the returned evidence.

The smoke harness uses privileged WebDriver access only in its disposable test
profile to trigger the browser action. The distributed extension does not request
DevTools, Marionette, a native helper, or system access. In the restricted Linux
test container, Firefox's child sandbox was disabled for this synthetic profile;
normal extension installation does not change browser sandbox settings.

Not verified: live ChatGPT account OAuth linking, live LinkedIn DOM, AMO signing
or approval, Opera, Safari, Android Firefox, and dedicated adapters for other job
sites. Tests establish the extension/companion protocol; they do not establish
public directory acceptance or compatibility with every dynamic website.

An unsigned AMO package is built with `npm run build`. Its source files are plain
packaged JavaScript/HTML/CSS/SVG; there is no extension compilation or remote code.
