# loomboard

LoomBoard is the user-facing application for intensive AI-agentic work with individual agents and agentic teams. It also includes project document editing and agentic-process visualization boards.

It is a thin **React + Vite + TypeScript** client over a [loomcycle](../loomcycle) runtime, talking to its `/v1/*` HTTP+SSE wire via the published [`@loomcycle/client`](https://www.npmjs.com/package/@loomcycle/client) SDK. There is no loomboard backend — loomcycle owns auth, persistence, and the agent loop.

The first surface is a **rich chat** UI: converse with registered loomcycle agents (full tool loop), with inline tool calls, scaffolded reasoning, markdown + math + emoji, a live token / throughput / context HUD, context compaction, and human-in-the-loop questions. (The kanban board from RFC AC lands later in the same app.)

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

Then in the connection screen enter your loomcycle **bearer token** and leave **Base URL blank** to use the dev proxy (forwards `/v1/*` to a local loomcycle at `http://127.0.0.1:8787`). Pick an agent and chat.

## Connecting to a remote loomcycle

loomcycle does **not** send CORS headers, so a browser cannot call a remote runtime cross-origin (entering an absolute URL in the connection screen will be blocked). Two ways to reach a remote:

- **Dev — point the proxy at it** (recommended for local work):
  ```bash
  LOOMBOARD_PROXY_TARGET=https://your-remote-loomcycle npm run dev
  ```
  Leave Base URL blank in the connection screen; requests ride the proxy, so no CORS is needed.
- **Production** — serve the built SPA behind a reverse proxy that also fronts loomcycle's `/v1/*` on the same origin (or add CORS support to loomcycle).

## Scripts

| Script | What |
|---|---|
| `npm run dev` | Vite dev server with the `/v1` proxy |
| `npm run build` | Typecheck + production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest unit tests (pure event reducer + metrics) |

## Architecture

- `src/lib/eventReducer.ts` — pure fold of the loomcycle `AgentEvent` stream into rendered messages; the same code path serves live streaming, transcript reload, and re-attach. Unit-tested.
- `src/lib/metrics.ts` — pure token-metric helpers (counts, tokens/sec, context %).
- `src/hooks/useChat.ts` — interactive-run lifecycle (start / steer / re-attach / resume), the only side-effecting orchestration.
- `src/state/` — connection (bearer/base URL) and the localStorage conversation index.
- `src/components/` — sidebar, chat pane, rich `Markdown`, `ThinkingBlock`, `ToolCard`, metrics HUD, interrupt card.

See [CLAUDE.md](CLAUDE.MD) for the development workflow and conventions.
