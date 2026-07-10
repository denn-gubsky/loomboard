# Publishing loomboard to the Chrome Web Store

Everything needed to submit the extension. The **package** steps are automated
(a script below); the **listing** steps you do in the Web Store dashboard using
the copy in this file.

## 1. Build the upload package

From the repo root:

```bash
npm run build:extension            # → extension/dist (tsc --noEmit + vite, prod)
VER=$(node -p "require('./extension/dist/manifest.json').version")
( cd extension/dist && zip -r -X "../../loomboard-extension-$VER.zip" . -x '.*' )
```

This yields `loomboard-extension-<version>.zip` with `manifest.json` at the zip
root — the format the Web Store expects. **Upload that zip.** (It's git-ignored.)

Bump `version` in `extension/manifest.config.ts` before each new upload — the Web
Store rejects a version already published.

## 2. One-time account setup

- Register a **Chrome Web Store developer account** at
  https://chrome.google.com/webstore/devconsole — a **one-time US$5 fee**, and
  account/email verification. Broad-permission extensions may also require
  identity verification.

## 3. Store-listing copy (paste into the dashboard)

**Name:** `loomboard`

**Summary / short description** (≤132 chars):
> A loomcycle chat in your browser side panel that reads and acts on the current page — summarize, extract, fill forms, click, navigate.

**Category:** Productivity _(alternatively Developer Tools)_
**Language:** English

**Detailed description:**
> loomboard puts a chat with your own loomcycle runtime in the Chrome side panel,
> and lets that AI assistant work on the page you're viewing — summarize it,
> extract and collect data, fill forms with your data, click, and navigate.
>
> loomboard is a thin client: it has no backend of its own. You point it at a
> loomcycle server you run (or one you've been given access to) and authenticate
> with your bearer token. Your page content and messages go only to that server;
> nothing is sent to the extension's developer.
>
> Requirements: a reachable loomcycle runtime (v1.16.x or newer) and a bearer
> token for it. See the project README for server setup.
>
> Safety: mutating actions (fill / click / navigate) are gated by an in-panel
> approval step by default, and password/payment fields always require your
> explicit confirmation. Page content is treated as untrusted data, never as
> instructions.

**Homepage / support URL:** your repo or site (e.g. the GitHub repo URL).

## 4. Privacy tab (required)

- **Single purpose:**
  > loomboard connects the browser to a user-provided loomcycle runtime so an AI
  > assistant can read and act on the current web page — summarize, extract, fill
  > forms, click, and navigate — from the side panel.

- **Privacy policy URL (required):** host `extension/PRIVACY.md` at a public URL
  (e.g. GitHub Pages, your site, or the rendered file on GitHub) and paste it.
  Fill in the contact line in that file first.

- **Permission justifications** (one per requested permission):
  - `sidePanel` — Hosts the assistant chat UI in the browser side panel.
  - `storage` — Stores your loomcycle server URL, bearer token, and chat locally on your device.
  - `scripting` — Injects the page-reading/acting content script on demand into the tab you're working on (e.g. a tab opened before the extension was updated).
  - `activeTab` — Access the tab you're currently working on to read/act on it at your request.
  - `tabs` — Identify the active tab and detect when a navigation you requested has completed.
  - **Host permissions** (`http://*/*`, `https://*/*`; the content script runs on all sites) — The assistant works on whatever site you're viewing, so it must read and act on the current page on any site; and it connects to the loomcycle server URL you enter (host access is requested at runtime for that origin).
  - **Remote code:** No — all code is bundled in the package; the extension loads and executes no remotely-hosted code.

- **Data usage** — declare that the extension handles, and transmits **only to the
  user-configured server** (never to the developer):
  - **Authentication information** — the bearer token (stored locally; sent only to your server).
  - **Website content** — page text/fields/links and the tab URL you ask it to work on.
  - **User communications** — your chat messages.
  - Certify: **not sold**; **not used or transferred for anything beyond the single
    purpose above**; **not used for creditworthiness/lending**. (All true.)

## 5. Graphics you must supply

- **Store icon 128×128** — reuse `extension/icons/icon-128.png`.
- **Screenshots** — at least one, **1280×800** or **640×400** (PNG/JPEG).
  Capture from a working install (`chrome://extensions` → Load unpacked
  `extension/dist`), e.g.:
  1. the Connect screen,
  2. the side panel with a chat answering about a page (bridge **connected**),
  3. the approval bar confirming a fill/click.
- _(Optional)_ small promo tile 440×280.

## 6. Submit

1. Dashboard → **Add new item** → upload the zip from step 1.
2. Fill the listing (§3), privacy (§4), and graphics (§5).
3. **Visibility:** start **Unlisted** (shareable link, not in search) if you want
   to pilot it; switch to Public later. Broad-permission items get **manual
   review** — expect anywhere from a day to a couple of weeks, and possibly a
   follow-up asking to justify the all-sites host access (the §4 text covers it).
4. **Submit for review.**

## 7. Updating later

Bump `version` in `extension/manifest.config.ts`, rebuild + rezip (step 1), then
in the dashboard open the item → **Package** → upload the new zip → resubmit.

## Review-scrutiny notes

- **Broad host access** (`<all_urls>` content script + `http/https` host perms) is
  the main thing reviewers question — the §4 host justification is the answer:
  it's a page assistant, so it needs the current page on any site.
- If review pushes back on **`http://*/*`** (plaintext), you can drop it and keep
  only `https://*/*` in `optional_host_permissions` (loomcycle behind TLS is the
  norm — see the README networking section); that trims one flagged permission.
- The **user-provided-server** model is unusual but fine — the listing + privacy
  policy make clear no data reaches the developer; that transparency helps review.
