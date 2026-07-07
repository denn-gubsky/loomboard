# loomboard — Chrome side-panel assistant

An agentic browser assistant: a single loomcycle chat in the Chrome **side panel**,
powered by a `chrome-assistant` agent that can **read the current page and act on it**
— summarize/collect data, fill fields, click, navigate — plus WebFetch, WebSearch, a
SQL save-data tool, and the Skill tool (e.g. `marketing/*`).

The agent runs server-side in loomcycle; the extension is its eyes and hands. Actuation
uses loomcycle's **client-executed tools** (RFC BC, v1.16.0): the side panel opens a
persistent WebSocket to loomcycle and registers the browser tools it can run
(`browser_read_page`, `fill`, `click`, `navigate`, …). When the agent calls one — e.g.
`client__browser_read_page` — loomcycle routes the call to this connection, the panel
runs it in the active tab, and returns the result as the tool's output. The connection
is keyed by your bearer's principal, so routing to *your* browser is automatic, and the
agent sees ordinary tool calls (no channel protocol).

## Build & load

```
npm run build:extension        # → extension/dist
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select `extension/dist`. Click the loomboard toolbar icon to open the side panel.

Dev with HMR: `npm run dev:extension` (load the generated `extension/dist`).

## Prerequisites (on your loomcycle runtime — operator config)

1. **loomcycle ≥ v1.16.0** — the release that ships client-executed tools
   (`GET /v1/client-tools`). No channels to declare; actuation is automatic once a
   connection is live.
2. **`LOOMCYCLE_SQLMEM_ENABLED=1`** — for the assistant's SQL save-data (`sql_scopes`).
3. **WebSearch Brave backend** configured — for the WebSearch tool.
4. Your **bearer token** must be allowed to create AgentDefs and to use the granted
   tools (`client__browser_*` / WebFetch / WebSearch / Memory / Skill).
5. To use skills (e.g. `marketing/*`), **register them in the loomcycle Library**
   (SkillDef); they're granted via the agent's `skills` allowlist.

On first connect the extension idempotently registers the `chrome-assistant` AgentDef
with `tools: [client__browser_*, WebFetch, WebSearch, Memory, Skill]` + the system prompt.
It is **create-if-absent** — if you already have a `chrome-assistant` from an older
(channel-bridge) build, grant it `client__browser_*` (you may drop `Channel`) so the
browser tools are offered; the extension won't rewrite an existing def.

## Usage

Connect (loomcycle URL + bearer). Chat with the assistant about the open page — e.g.
"summarize this page", "collect the product prices into a table and save them", "fill
this form with … and submit". Actions are gated by an **approval bar** in **Confirm**
mode (default); switch to **Auto** to run actions immediately (a **Stop** button
dismisses a pending action). Sensitive fields (passwords, payment) always require
confirmation. A status line shows whether the client-tool WebSocket is connected.

## Security & trust model

This is a powerful, deliberately broad capability. Read this before using it on
sensitive sites.

- **Broad host access.** The content script runs on `<all_urls>` (the "read and change
  data on all sites" install prompt) so the assistant can work on any page; the loomcycle
  origin is granted at connect time so the panel can reach it. This is appropriate for a
  browser assistant but is real, broad access.
- **Page content is UNTRUSTED.** The assistant treats page text/snapshots as *data*, not
  instructions (enforced in its system prompt), and never executes page content.
- **Confirm-by-default + sensitive-field guard.** Mutating actions (fill/click/navigate)
  wait for your approval in Confirm mode; password/payment fields force confirmation even
  in Auto mode; nothing is auto-submitted without your say-so.
- **Residual risk — data egress is NOT gated by the approval bar.** The approval bar is
  *client-side*: it can only gate the browser bridge (fill/click/navigate). The agent's
  `WebFetch`/`WebSearch`/`Memory` run *server-side in loomcycle*, so a prompt-injected
  page could, in principle, induce the agent to send page data outward without an approval
  prompt (a confused-deputy attack). Mitigations: the system prompt explicitly forbids
  fetching/searching URLs or content that originate in the page; everything runs under
  **your own principal** (no privilege escalation — the agent can do only what your bearer
  allows); and you see the agent's tool activity in the chat. To reduce this surface,
  operators can restrict WebFetch's host allowlist, or you can drop WebFetch/WebSearch
  from the agent's tools if you don't need web research.
- **Token hygiene.** The bearer lives only in `chrome.storage.local`; it is never logged
  and never placed in a tool payload. On the client-tool WebSocket it rides the
  `Sec-WebSocket-Protocol` subprotocol (browsers can't set an Authorization header).

## Layout

- `extension/` — MV3 manifest, service worker (opens the panel), and the `content/`
  executor (page snapshot + action execution).
- `src/panel/` — the side-panel React root (connect, `<Chat>`, action bar, mode toggle).
- `src/bridge/` — the client-tool host (WebSocket registration + invoke handling), the
  internal command/result protocol, tab dispatch, agent setup, and the embedded system
  prompt.
- `src/state/chromeStorage.ts` + `ext*.ts` — chrome.storage-backed settings / conversation
  / mode.
