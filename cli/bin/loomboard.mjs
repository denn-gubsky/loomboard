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

Usage: loomboard [--port <n>] [--loomcycle <url>] [--no-open]

  --port <n>         Port to listen on (default 4173, or $PORT)
  --loomcycle <url>  Default loomcycle target used when the connection screen's
                     Base URL is left blank (default $LOOMBOARD_PROXY_TARGET or
                     http://127.0.0.1:8787)
  --no-open          Don't open the browser automatically
  -h, --help         Show this help

Enter your loomcycle bearer token in the app's connection screen; it stays in
your browser and is never read or stored by this CLI.`);
  process.exit(0);
}

const port = Number(arg("--port", process.env.PORT || "4173"));
const defaultTarget = arg(
  "--loomcycle",
  process.env.LOOMBOARD_PROXY_TARGET || "http://127.0.0.1:8787",
);
const noOpen = argv.includes("--no-open");

// Static SPA with history fallback (single-page app → serve index.html for
// unknown routes).
const serve = sirv(publicDir, { single: true, dev: false });

// Reverse-proxy /v1 to the target the app names per request via the
// x-loomcycle-target header (set from the connection screen's Base URL),
// falling back to defaultTarget. changeOrigin so the upstream sees its own
// host; secure:false to allow self-signed TLS on LAN runtimes.
const proxy = createProxyMiddleware({
  target: defaultTarget,
  changeOrigin: true,
  secure: false,
  pathFilter: (path) => path.startsWith("/v1"),
  router: (req) => {
    const t = req.headers["x-loomcycle-target"];
    const target = Array.isArray(t) ? t[0] : t;
    return target || undefined;
  },
});

const server = http.createServer((req, res) => {
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

server.listen(port, () => {
  const url = `http://localhost:${port}`;
  console.log(`\n  loomboard  →  ${url}`);
  console.log(`  /v1 proxied to the connection screen's Base URL (default ${defaultTarget})`);
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
