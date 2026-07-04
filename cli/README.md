# @loomboard/app

Run the [loomboard](https://github.com/denn-gubsky/loomboard) chat app locally — no build step, no CORS setup. Works on Linux, macOS, and Windows (anywhere Node ≥ 18 runs).

```bash
npm install -g @loomboard/app
loomboard
```

This starts a local server, opens your browser, and shows the loomboard chat UI. In the connection screen enter your **loomcycle Base URL** and **bearer token**, pick an agent, and chat.

Prefer not to install globally? Use it one-shot:

```bash
npx @loomboard/app
```

## Why a local server?

loomboard is a browser SPA that talks to a loomcycle runtime over `/v1/*`. loomcycle sends no CORS headers, so a browser can't call a remote runtime cross-origin. This CLI serves the app **and reverse-proxies `/v1/*`** to the loomcycle you name in the connection screen — so any reachable runtime (local, LAN/TrueNAS, remote) works with no extra setup.

Your **bearer token stays in the browser** (localStorage) and is only forwarded upstream on your requests — this process never reads, stores, or logs it.

## Options

```
loomboard [--port <n>] [--loomcycle <url>] [--no-open]

  --port <n>         Port to listen on (default 4173, or $PORT)
  --loomcycle <url>  Default loomcycle target when the Base URL is left blank
                     (default $LOOMBOARD_PROXY_TARGET or http://127.0.0.1:8787)
  --no-open          Don't open the browser automatically
```

## Embedding instead?

If you want the chat *inside* your own React app rather than as a standalone tool, use the component: [`@loomboard/chat`](https://www.npmjs.com/package/@loomboard/chat).
