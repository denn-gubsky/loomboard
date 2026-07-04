#!/usr/bin/env node
// loomboard — run the chat app locally. Serves the prebuilt SPA and
// reverse-proxies /v1/* to your loomcycle so the browser isn't blocked by
// loomcycle's lack of CORS. The bearer token is entered in the app's connection
// screen and lives in your browser — this process never reads or stores it.
import http from "node:http";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sirv from "sirv";
import { createProxyMiddleware } from "http-proxy-middleware";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`loomboard — serve the loomboard chat app locally.

Usage: loomboard [--port <n>] [--host <addr>] [--loomcycle <url>] [--insecure] [--no-open]

  --port <n>         Port to listen on (default 4173, or $PORT)
  --host <addr>      Interface to bind (default 127.0.0.1). Loopback keeps the
                     /v1 proxy private to this machine; binding a non-loopback
                     address exposes it as an open proxy (see warning).
  --loomcycle <url>  Default loomcycle target used when the connection screen's
                     Base URL is left blank (default $LOOMBOARD_PROXY_TARGET or
                     http://127.0.0.1:8787)
  --insecure         Don't verify the loomcycle's TLS certificate (only for a
                     runtime with a self-signed cert on your LAN)
  --no-open          Don't open the browser automatically
  -h, --help         Show this help

Enter your loomcycle bearer token in the app's connection screen; it stays in
your browser and is never read or stored by this CLI.`);
  process.exit(0);
}

const port = Number(arg("--port", process.env.PORT || "4173"));
const host = arg("--host", process.env.HOST || "127.0.0.1");
const defaultTarget = arg(
  "--loomcycle",
  process.env.LOOMBOARD_PROXY_TARGET || "http://127.0.0.1:8787",
);
const insecure = argv.includes("--insecure");
const noOpen = argv.includes("--no-open");
const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";

// Static SPA with history fallback (single-page app → serve index.html for
// unknown routes).
const serve = sirv(publicDir, { single: true, dev: false });

// Reverse-proxy /v1 to the target the app names per request via the
// x-loomcycle-target header (set from the connection screen's Base URL),
// falling back to defaultTarget. changeOrigin so the upstream sees its own
// host. TLS certs are verified by default; --insecure allows a self-signed
// runtime on your LAN.
const proxy = createProxyMiddleware({
  target: defaultTarget,
  changeOrigin: true,
  secure: !insecure,
  pathFilter: (path) => path.startsWith("/v1"),
  router: (req) => {
    const t = req.headers["x-loomcycle-target"];
    const target = Array.isArray(t) ? t[0] : t;
    return target || undefined;
  },
});

// Reject requests whose Host isn't a loopback name when bound to loopback (the
// default). This defeats DNS-rebinding: a malicious site can rebind its domain
// to 127.0.0.1 and reach this server, but the browser still sends that site's
// Host header — which we refuse — so it can't drive the /v1 proxy or read
// anything served here. (When the user has explicitly bound a non-loopback
// --host, they've opted into exposure and we don't second-guess the Host.)
function hostAllowed(req) {
  if (!isLoopback) return true;
  const raw = (req.headers.host || "").toLowerCase();
  const name = raw.replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

const server = http.createServer((req, res) => {
  if (!hostAllowed(req)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return;
  }
  if (req.url && req.url.startsWith("/v1")) {
    proxy(req, res, () => {
      res.statusCode = 502;
      res.end("Bad gateway");
    });
    return;
  }
  serve(req, res, () => {
    res.statusCode = 404;
    res.end("Not found");
  });
});

server.on("error", (err) => {
  if (err && err.code === "EADDRINUSE") {
    console.error(`\n  Port ${port} is in use. Try: loomboard --port ${port + 1}\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(port, host, () => {
  const shown = isLoopback ? "localhost" : host;
  const url = `http://${shown}:${port}`;
  console.log(`\n  loomboard  →  ${url}`);
  console.log(`  /v1 proxied to the connection screen's Base URL (default ${defaultTarget})`);
  if (!isLoopback) {
    console.log(
      `  ⚠  Bound to ${host} (not loopback): the /v1 proxy is reachable by other\n` +
        `     hosts, i.e. an open proxy. Only do this on a network you trust.`,
    );
  }
  console.log(`  Ctrl+C to stop.\n`);
  if (!noOpen) openBrowser(url);
});

// Open the default browser cross-platform without a dependency.
function openBrowser(url) {
  const p = process.platform;
  const cmd = p === "darwin" ? "open" : p === "win32" ? "cmd" : "xdg-open";
  const args = p === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // best-effort — the URL is printed above
  }
}
