# @loomboard/chat

An embeddable **React chat component** for the [loomcycle](https://www.npmjs.com/package/@loomcycle/client) agentic runtime. Drop `<Chat>` into your app to converse with a registered loomcycle agent — full tool loop, streamed text, scaffolded reasoning, inline tool calls, markdown + math + emoji, image/file attachments, a live token / throughput / context HUD, context compaction, and human-in-the-loop questions.

It is a **thin client**: it talks to a running loomcycle over its `/v1/*` HTTP+SSE wire via the `@loomcycle/client` SDK. There is no backend of its own — loomcycle owns auth, persistence, and the agent loop. The component drives **one conversation**; your app owns which conversation is shown and how it's persisted.

> **Just want to run it, not embed it?** Install the standalone app: `npm i -g @loomboard/app`, then `loomboard`. It serves the full UI and proxies to your loomcycle — see [`cli/`](cli/).

## Install

```bash
npm install @loomboard/chat
```

Peer dependencies (you provide these): `react`, `react-dom`, and `@loomcycle/client`.

## Usage

`<Chat>` is **controlled**: you pass the conversation record and persist the patches it emits (session/run ids, title, the agent/config the user picks).

```tsx
import { useState } from "react";
import { Chat, type ChatConversation } from "@loomboard/chat";
import "@loomboard/chat/styles.css";

export function MyChat() {
  const [conversation, setConversation] = useState<ChatConversation>({
    id: "c1",
    title: "New chat",
    baseAgent: "chat", // a registered loomcycle agent
    config: {},        // provider/model/tier/effort overrides (optional)
  });

  return (
    <div style={{ height: "100vh" }}>
      <Chat
        connection={{ baseUrl: "https://your-loomcycle.example", token: "…" }}
        conversation={conversation}
        onConversationChange={(patch) =>
          setConversation((c) => ({ ...c, ...patch }))
        }
      />
    </div>
  );
}
```

Persist `conversation` however you like (localStorage, your DB, server state). Reopening a chat with a stored `sessionId` reloads its transcript from loomcycle.

## Props

| Prop | Type | Notes |
|---|---|---|
| `connection` | `{ baseUrl: string; token?: string; fetch?: typeof fetch }` | How to reach loomcycle. The component builds and memoizes its client. `fetch` is an optional override (proxying, header injection). |
| `conversation` | `ChatConversation` | Controlled record: `{ id, title, baseAgent, config, sessionId?, runId?, forkDefName? }`. |
| `onConversationChange` | `(patch: Partial<ChatConversation>) => void` | Called when the chat produces state to persist (ids, title, agent, config). |
| `theme` | `"light" \| "dark"` | Optional. Omit to inherit a `data-theme` ancestor (e.g. an app that themes `<html>`); defaults to dark. |

Also exported: `ConversationConfig`, `Connection`, `createLoomcycleClient`, and the pure helpers `configIsCustom` / `sameConfig`.

## Styling & theming

Import the stylesheet once: `import "@loomboard/chat/styles.css"`. All rules are scoped under the component's `.loomchat` root and the palette is a set of CSS variables on that root, so nothing leaks into — or is clobbered by — your app.

- **Force a theme:** `<Chat theme="light" />`.
- **Inherit the app's theme:** set `data-theme="light"` (or `"dark"`) on any ancestor (e.g. `<html>`); the chat follows automatically — no prop needed.
- **Restyle:** override any `--var` on `.loomchat` (e.g. `--accent`, `--bg`, `--bubble`).

`katex` (math) and `highlight.js` (code) CSS are imported by the component itself, so you don't need to add them.

## Requirements

A reachable loomcycle runtime and a bearer token scoped by it. Note loomcycle does not send CORS headers, so from a browser you'll typically reach it same-origin (a reverse proxy fronting `/v1/*`) or via the `connection.fetch` override.

---

## Development (demo app)

This repo doubles as a demo/dogfood app (sidebar, conversation list, connection screen) that consumes the component from `src/chat`.

```bash
npm install
npm run dev        # http://localhost:5173
```

Open it at `http://127.0.0.1:5173`, enter the loomcycle **Base URL** and press **Sign in with loomcycle** (see below), or paste a bearer under **Advanced**. Leave the Base URL blank to use the dev proxy's default (forwards `/v1/*` and the OAuth metadata to `http://127.0.0.1:8787`, or `LOOMBOARD_PROXY_TARGET`). The proxy lets the browser reach any runtime with no CORS.

### Sign in with loomcycle

The app, the Chrome extension and the desktop app sign in through loomcycle's own sign-in page (RFC FL — loomcycle is an OAuth 2.0 authorization server for its registered apps): the person enters only the Base URL, signs in with whatever gates the operator configured (password, SSO, a pasted token…), and comes back with a short-lived token for that user. loomboard never sees a password and authorizes nothing itself. Pasting a bearer stays available under **Advanced**, for `auth.mode: token` deployments and automation.

**What the operator sets up** on loomcycle (`auth.clients.loomboard`; full reference in loomcycle's `docs/CONFIGURATION.md`, "App sign-in"):

- `LOOMCYCLE_PUBLIC_URL` — the issuer. Without it the server publishes no metadata and loomboard offers only the token path.
- an interactive gate in `auth.gates`.
- `LOOMCYCLE_PRESETS=…,loomboard` — registers the client with the desktop app's addresses (loopback `http://127.0.0.1/auth/callback`, any port; `com.loomboard.app:/auth/callback`; origins `tauri://localhost`, `http://tauri.localhost`).
- the addresses that differ per install, added with `!append`:

```yaml
auth:
  clients:
    loomboard:
      redirect_uris: !append
        - https://board.example.com/auth/callback          # the web app
        - https://<extension-id>.chromiumapp.org/          # the extension (shown on its sign-in screen)
      allowed_origins: !append
        - https://board.example.com
        - chrome-extension://<extension-id>
        - http://127.0.0.1:5173                            # `npm run dev` (4173 for the loomboard CLI)
```

The desktop app opens nothing but that server's own sign-in page, over `https`, or over plain `http` only when the Base URL is an IP literal on this machine or a private network (`10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `fc00::/7`, `fe80::/10` — a plain-HTTP LAN install such as `http://192.168.0.77:8787`). A host name over `http` is refused: a name can resolve anywhere.

**A plain-HTTP LAN loomcycle** works with these settings: `LOOMCYCLE_PUBLIC_URL=http://<lan-ip>:<port>` (the same address people enter as the Base URL), a token or password gate (OIDC, OAuth and passkey gates refuse a non-loopback `http` public URL at load), and, in `auth.mode: strict`, `LOOMCYCLE_UI_INSECURE_COOKIES=1` for the sign-in page's session over http. The desktop app's loopback redirect and Tauri origins come from the `loomboard` preset unchanged. A web app on `127.0.0.1` needs no redirect entry (the preset's loopback one matches any port), only its origin. Over plain http, open loomboard at `127.0.0.1`, not `localhost`: loomcycle accepts http redirects only to a loopback IP. A static host must answer `/auth/callback` with `index.html`.

**Per form factor:**

| | How the person signs in | Where the tokens live |
|---|---|---|
| web | full-page redirect, back to `/auth/callback` (code and state are wiped from the address bar first; the page sends no `Referer`) | the tab's `sessionStorage` (survives a reload, gone with the tab) |
| extension | `chrome.identity.launchWebAuthFlow`, back to `https://<id>.chromiumapp.org/` | `chrome.storage.session` (cleared when the browser quits), shared by the extension's panels |
| desktop | the system browser, back to a one-shot listener on a random `127.0.0.1` port that answers only this sign-in's state | the OS keychain (`com.loomboard.app`) |

What is stored is the refresh token with the current access token and its expiry, so a start within the token's hour refreshes nothing. No token is ever written to `localStorage` or a URL. Sign-out — and connecting with a pasted token instead — revokes the sign-in on loomcycle (RFC 7009) and clears what was stored; a sign-in loomcycle ends (revoked, user disabled, expired) returns to the sign-in screen with a message.

A refresh token rotates on every use, and two holders refreshing it at once end the sign-in. Refreshes take turns under a Web Lock and pick up a rotation another holder made, which is how extension panels in several windows share one sign-in. Browser tabs do not share `sessionStorage`, so a sign-in belongs to the tab that made it: a duplicated tab (which copies `sessionStorage`) does not resume it and asks you to sign in again — quick if you are still signed in to loomcycle in that browser.

**The sign-in address check.** loomboard signs in only if the server's issuer (`LOOMCYCLE_PUBLIC_URL`) is on the origin of the Base URL you entered; the button shows the host you will be sent to. The code exchange always goes to the Base URL, so a server — or a proxy in front of one — that named another server's sign-in would receive that server's code. There is no override: if the check fails, enter loomcycle's public address as the Base URL.

| Script | What |
|---|---|
| `npm run dev` | Vite dev server with the `/v1` proxy |
| `npm run build` | Typecheck + production build of the demo app |
| `npm run build:lib` | Build the publishable library to `dist/` (ESM + CJS + types + `styles.css`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest unit tests (pure event reducer, metrics, history, config) |

### Architecture

- `src/chat/` — the published component (self-contained).
  - `Chat.tsx` — the surface; `index.ts` — public API; `styles.css` — scoped styles.
  - `lib/eventReducer.ts` — pure fold of the loomcycle `AgentEvent` stream into rendered messages (live, transcript reload, re-attach). Unit-tested.
  - `lib/metrics.ts` — pure token-metric helpers. `hooks/useChat.ts` — interactive-run lifecycle (the side-effecting orchestration).
- `src/` (outside `chat/`) — the demo app: sidebar, conversation list, connection screen, and the localStorage conversation index.

See [CLAUDE.md](CLAUDE.md) for the development workflow and conventions.
