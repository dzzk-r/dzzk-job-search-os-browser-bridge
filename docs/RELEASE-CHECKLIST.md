# Release status — 0.1.1

## Ready

- Firefox MV3 package, minimum desktop Firefox 140; fixed loopback endpoint.
- MIT source, attribution, repository homepage and issue tracker.
- AMO listing description, data disclosures, privacy policy and reviewer steps.
- Public beta source and unsigned extension package through GitHub releases.
- Local OAuth/PKCE companion with explicit client consent and read-only tools.
- Persistent per-client operation controls and global pause; Firefox UI for both.
- Synthetic tests and reproducible real Firefox smoke harness. See VALIDATION.md.

## Needed for Mozilla Add-ons publication

1. Sign into the developer's Mozilla Add-ons account; account/terms steps belong
   to the account owner when user confirmation is required.
2. Choose public distribution and upload
   `dist/dzzk_job_search_os_browser_bridge-0.1.1.zip`.
3. Use AMO-LISTING.md for the listing and review notes, PRIVACY.md for the policy;
   review the permission/data questions against the manifest.
4. Check validation, signing, review and the actual public listing URL. Do not
   describe the beta as AMO-published until that URL and status are verified.
5. Download and test the signed XPI through normal Firefox installation.

An unsigned GitHub release does not reserve an approved AMO listing or name.
No Mozilla credentials or signing secrets belong in the repository.

## Needed for a public ChatGPT plugin

- A stable supported HTTPS endpoint or supported private transport to the
  owner's companion. Loopback alone is not remotely accessible by ChatGPT.
- Live ChatGPT OAuth linking, tool discovery and explicit page reads verified.
- A tested installation and reconnect flow suitable for users and reviewers.
- Production directory review and acceptance; DIRECTORY-LISTING.md is a draft.

Live LinkedIn DOM, Firefox Android, Opera, Safari and dedicated alternative job
site adapters remain unverified. Generic page extraction is not a guarantee
that every site's dynamic content will be readable.
