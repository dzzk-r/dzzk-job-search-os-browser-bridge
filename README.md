# dzzk Job Search OS — Browser Bridge

User-controlled browser access for job-search workflows in ChatGPT.

The project connects **dzzk Job Search OS** to browser sessions the user already owns, so authenticated job-search evidence can be read and worked with without building a separate integration for every job board, ATS, recruiter portal, or professional network.

## Why this exists

Job-search evidence is fragmented across:

- job boards and ATS pages;
- recruiter messages;
- application trackers;
- company career sites;
- authenticated browser-only pages;
- email and local artifacts.

Browser Bridge provides a narrow, user-controlled bridge from ChatGPT to selected browser tabs instead of treating each site as a separate API integration.

## Browser paths

### Opera

dzzk Job Search OS can use the **Opera Browser Connector** when the user has enabled it in Opera and connected it to ChatGPT.

This project does not redistribute or impersonate Opera Browser Connector. Opera and Opera Browser Connector remain third-party products controlled by their respective owners.

### Firefox

The project also provides a **dzzk Job Search OS Browser Bridge extension for Firefox**.

The Firefox path is designed around WebExtensions and the user's existing authenticated browser session. It is intended to expose only explicitly shared tabs and capabilities.

Firefox is a trademark of the Mozilla Foundation. This project is independent and is not affiliated with, sponsored by, or endorsed by Mozilla.
## Initial capability surface

The first public interface is intentionally small:

- list shared tabs;
- read page text;
- capture a screenshot;
- navigate a shared tab;
- find text on a page;
- click an element;
- type into an element.

Cookies, saved passwords, authentication tokens, and raw browser profile data are **not** part of the public interface.

## Permission model

The target model is tab-centric rather than browser-wide:

```text
Browser
  └── explicitly shared tab
        ├── read
        ├── screenshot
        ├── navigate
        ├── click      [optional]
        └── type       [optional]
```

Read access and state-changing actions should remain separately controllable.

## Job Search OS use cases

Examples:

- “Find the recruiter message where we discussed the home assignment.”
- “Read the current job page and compare it with my application record.”
- “Check whether this ATS page still shows my application as active.”
- “Extract the exact office-policy wording from this authenticated posting.”
- “Open the recruiter thread and show the last concrete next step.”

The bridge is transport. Job Search OS remains responsible for reconciliation, evidence provenance, and deciding which source wins when records conflict.

## Project status

Early public bootstrap. The repository name and product namespace are reserved; implementation is being extracted from a working local Firefox/Marionette proof of concept into a narrower WebExtension-based design.

See:

- `docs/DIRECTORY-LISTING.md`
- `docs/COMPATIBILITY.md`
- `docs/SECURITY-BOUNDARY.md`
