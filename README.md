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

Enter your loomcycle bearer token and leave **Base URL blank** to use the dev proxy (forwards `/v1/*` to `http://127.0.0.1:8787`, or `LOOMBOARD_PROXY_TARGET`). The proxy lets the browser reach any runtime with no CORS.

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
