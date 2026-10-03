# Mozilla Add-ons submission — version 0.1.1

Name: dzzk Job Search OS Browser Bridge

Summary:
Share selected job pages and recruiter conversations with your MCP client.
Requires the local dzzk companion.

## Description

Bring selected pages from your existing Firefox session into your job-search
workflow. Read visible job listings and recruiter conversations, including
pages you have already signed into on LinkedIn and other sites.

You choose each page from the extension toolbar. Your authorized MCP client can
list shared pages, read text and find passages. Access expires after 30 minutes
and ends when you navigate, reload, close the tab or stop sharing. This release
is read-only: it does not send messages or submit job applications. Pause all
actions stops further calls and removes shared pages. For each authorized client,
choose Allow, Ask every time or Block for each operation. A one-time approval
never authorizes later requests.

Setup requires Firefox 140+, Node.js 22+ and the separately installed open-source
dzzk companion. ChatGPT needs a developer-mode MCP connection and a supported
transport to your companion; installing this extension alone does not connect it
to ChatGPT. See the README for setup. There is no required paid browser-automation
service or developer-operated relay. Your MCP client and tunnel provider may
have their own availability, plan and usage requirements.

No browser history or cookies export. No analytics or advertising. Shared text,
titles and URLs pass to your local companion and then to your authorized MCP
client, which can be remote. Review the privacy policy before sharing pages.

Independent project by Daniel Chechik (dzzk). Not affiliated with or endorsed by
Mozilla, OpenAI, LinkedIn or Opera. Those names identify compatibility only.

Homepage / support:
https://github.com/dzzk-r/dzzk-job-search-os-browser-bridge
https://github.com/dzzk-r/dzzk-job-search-os-browser-bridge/issues

Privacy policy:
https://github.com/dzzk-r/dzzk-job-search-os-browser-bridge/blob/main/docs/PRIVACY.md

License: MIT. Suggested category: Productivity.

## Reviewer instructions

All extension code is plain packaged JavaScript, HTML and CSS. No build step,
remote executable code, eval, minification or binary helper in the extension.
The companion is separately installed; run `npm ci`, then `npm start` from the
repository and paste the displayed pairing token into extension settings.
Use a normal test web page; no LinkedIn account is required for validation.
Authorize a test MCP client through the extension popup and share the page.
Verify read, find, revocation and refusal for an unshared handle. Test Ask with
Allow once and Deny once, then Block and Pause all actions. Resuming must not
restore prior shared pages. Test scripts
and the reproducible Firefox smoke check are included in the repository.

The localhost host permission is solely for companion HTTP requests on port
43119. `activeTab` authorizes reading only after a toolbar interaction. No broad
website permission or `tabs` permission is requested.

## Submission state

An unsigned build is not a published or permanently installable Firefox release.
Signing and the public listing require an authenticated Mozilla Add-ons submission
and Mozilla approval. Update this state only after checking the submission result.
