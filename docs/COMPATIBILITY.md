# Browser Compatibility and Cost Model

## Opera path

Opera publicly describes its desktop browser as a free browser and provides direct downloads for Windows, macOS, and Linux.

When **Opera Browser Connector** is available and enabled by the user in Opera, dzzk Job Search OS can use that connector as a browser-access path.

There is no need for this project to ship an Opera-specific clone of the connector.

Important: Opera Browser Connector is a third-party integration. Availability, behavior, and terms are controlled by Opera / the connector provider, not by dzzk.

## Firefox path

Firefox is free and open-source browser software.

The dzzk path is an independent browser extension / bridge intended to work with Firefox using WebExtensions and the user's existing browser session.

The design goal is that the Firefox path itself requires no paid browser-automation service.

This does **not** mean that every external website, ChatGPT plan, network service, or third-party account used with the bridge is guaranteed to be free.

## Why both paths matter

```text
dzzk Job Search OS
        |
        +-- Opera -> Opera Browser Connector -> user browser session
        |
        +-- Firefox -> dzzk Browser Bridge -> user browser session
```

The shared abstraction is not a particular browser. It is:

**user-controlled access to a browser session the user is already authenticated in.**

## Trademark boundary

Opera and Firefox are referenced only to describe compatibility.

The product is named **dzzk Job Search OS** and the component is named **dzzk Browser Bridge**.

For Mozilla compatibility wording, the intended form is:

**dzzk Job Search OS Browser Bridge for Firefox**

not:

**Firefox dzzk Job Search OS Browser Bridge**
