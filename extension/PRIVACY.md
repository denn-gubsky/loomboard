# loomboard — Privacy Policy

_Last updated: 2026-07-08_

loomboard is a Chrome extension that puts a chat with your **own** loomcycle
runtime in the browser side panel, and lets that assistant read and act on the
web page you're viewing. This policy explains exactly what data the extension
touches and where it goes.

**The short version:** loomboard has no backend of its own. It talks only to the
loomcycle server **you** configure. It sends nothing to the developer, uses no
analytics, and shows no ads.

## What the extension accesses

- **Your connection settings** — the loomcycle server URL and the bearer token
  you enter on the Connect screen.
- **Web page content** — when you ask the assistant about a page, the extension
  reads that page (visible text, form fields, links, your current selection, and
  the tab's URL/title) so the assistant can summarize it, extract data, or act on
  it at your request.
- **Your chat messages** — what you type to the assistant.

## Where that data goes

- **Connection settings are stored locally**, in `chrome.storage.local` on your
  own device. They are never transmitted anywhere except as described next, and
  are removed when you disconnect or uninstall the extension.
- **Your bearer token** is sent **only to the loomcycle server you configured**,
  to authenticate your requests (over the `Authorization` header for HTTP and the
  `Sec-WebSocket-Protocol` subprotocol for the client-tool WebSocket). It is never
  logged, never shown, and never sent to any other party.
- **Page content and chat messages are sent only to the loomcycle server you
  configured**, so your agent can act on your request. That server is operated by
  **you** or an operator **you** chose — not by the extension's developer.

The developer of loomboard operates **no servers** and receives **none** of your
data. There is no first-party collection, no analytics, no advertising, no
tracking, and no sale or sharing of data with third parties.

## Data you send to a page

When you ask the assistant to fill a form or click, it acts on the current page
on your behalf. That happens locally in your browser; the extension does not
transmit that action anywhere except back to your loomcycle server as part of the
result the agent requested.

## Your control

- Everything the extension stores lives in your browser's extension storage.
  **Disconnect** (in the side panel) or **remove the extension** to erase the
  stored server URL and token.
- The assistant reads a page only when you ask it to work on that page.
- Mutating actions (fill / click / navigate) are gated by an in-panel approval
  step by default, and fields such as passwords or payment always require your
  explicit confirmation.

## Data handled by your loomcycle server

Once page content or messages reach the loomcycle server you configured, their
handling is governed by **that server's** configuration and policies, which are
outside loomboard's control. If you don't operate the server yourself, review the
policy of whoever does.

## Contact

Questions about this policy: **<add your contact email / URL before publishing>**.

## Changes

Material changes will be reflected here with an updated date. Continued use after
a change constitutes acceptance of the revised policy.
