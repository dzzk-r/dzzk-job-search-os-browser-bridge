# Security Boundary

## Principle

Browser Bridge should expose the minimum browser capability required for the user's requested task.

The target boundary is **shared tabs and explicit capabilities**, not unrestricted access to the whole browser profile.

## In scope

- enumerate explicitly shared tabs;
- read rendered page text;
- capture a screenshot of a shared tab;
- navigate a shared tab;
- find content;
- optionally click or type when the user has enabled those capabilities.

## Out of scope for the public bridge

- saved passwords;
- raw cookies;
- authentication tokens;
- browser profile databases;
- arbitrary filesystem access;
- silent access to tabs the user did not share;
- background export of browsing history by default.

## Read vs write

Read actions and state-changing actions should be treated separately.

Examples of state-changing actions include:

- submitting a job application;
- sending a recruiter message;
- changing an ATS form;
- accepting terms;
- deleting or closing user content.

Those actions should require stronger permission than reading a page.

## Existing authentication

The bridge may operate on pages where the user is already authenticated in the browser.

It must not present that as a direct API integration with the website, and it must not claim endorsement or partnership with the website being accessed.

## Product boundary

The bridge transports browser evidence and browser actions.

Job Search OS is responsible for:

- provenance;
- reconciliation;
- status interpretation;
- workflow decisions;
- evidence retention policy.
