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
   connection is live. Browser clients additionally need the client-tool **Origin fix**
   (recent 1.16.x) — see [Networking](#networking-behind-a-reverse-proxy--tailscale-serve).
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

## Networking: behind a reverse proxy / tailscale serve

The client-tool connection is a **WebSocket** (`wss://<your-loomcycle>/v1/client-tools`),
separate from the chat's HTTP/SSE — so **chat working does not mean the socket works**. If
loomcycle sits behind a TLS-terminating front (nginx, Nginx Proxy Manager, Traefik, Caddy,
`tailscale serve`, Cloudflare…), that front has to carry the WebSocket. Four things must hold:

1. **Forward the WebSocket upgrade.** Nginx Proxy Manager: enable **"Websockets Support"** on
   the proxy host. Raw nginx: `proxy_http_version 1.1;` + `proxy_set_header Upgrade $http_upgrade;`
   + `proxy_set_header Connection "upgrade";`. Caddy/Traefik do this automatically.
2. **`wss://`, not `ws://`.** The side panel is a secure context, so Chrome blocks insecure
   `ws://`. Point the extension **Base URL** at the front's **HTTPS** endpoint (the socket then
   becomes `wss://…`) with a **browser-trusted** cert (public CA / Let's Encrypt / the
   `tailscale cert` output) — a self-signed cert for a local name is rejected.
3. **Prefer HTTP/1.1 for the socket.** Some fronts advertise HTTP/2 but don't proxy
   WebSocket-over-HTTP/2, so the browser handshake fails even though `curl --http1.1` succeeds.
   In Nginx Proxy Manager, turn **off "HTTP/2 Support"** on the proxy host if the socket won't
   open. **`tailscale serve` has no such toggle and may not carry browser WebSockets** — put a
   WS-aware proxy (e.g. NPM) in front of loomcycle if serve won't.
4. **loomcycle must accept the browser's `Origin`.** Browsers send `Origin: chrome-extension://<id>`;
   the client-tool endpoint must not reject cross-origin (auth is the bearer in the subprotocol,
   not cookies). Needs a loomcycle build with the client-tool Origin fix (recent 1.16.x).

**Quick check** (run where it can reach the front; expect `HTTP/1.1 101 Switching Protocols`):
```bash
curl -i --http1.1 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  -H "Sec-WebSocket-Protocol: loomcycle.client-tools.v1, bearer.$LOOMCYCLE_AUTH_TOKEN" \
  https://<your-loomcycle>/v1/client-tools
```
`curl` sends no `Origin`, so a `101` here still doesn't prove a browser will connect (see #4) —
test the extension too. **Diagnose from the panel:** right-click the side panel → **Inspect** →
**Network → WS → `client-tools`** (its status + `Protocol` column), or read the bridge status
line under the toolbar.

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
