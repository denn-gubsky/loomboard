// The loomboard container's server: the built SPA, the settings it reads when
// the page loads (/runtime-config.js), and a same-origin proxy to ONE loomcycle
// runtime (loomcycle sends no CORS headers). Node built-ins only, so the image
// carries no npm packages.
//
// Unlike the CLI (cli/bin/loomboard.mjs), the upstream is fixed by the
// operator: the app's x-loomcycle-target header is dropped, never followed, so
// this is not an open relay. With no LOOMCYCLE_UPSTREAM it serves the app alone,
// for a deployment that routes /v1 to the runtime itself.
//
// Environment:
//   PORT                       listen port (default 8080)
//   SRV_ROOT                   the built app (default /srv)
//   LOOMCYCLE_UPSTREAM         the runtime, e.g. http://loomcycle:8787 (optional)
//   LOOMBOARD_CONNECT_ORIGINS  comma-separated origins allowed to hand the app a
//                              bearer by postMessage (optional; unset = none)
import http from "node:http";
import https from "node:https";
import { stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
};

// What goes to loomcycle: the /v1 API, and the OAuth metadata "Sign in with
// loomcycle" reads first (RFC 8414 serves it at the root, outside /v1). The app
// fetches both relative to its own origin.
const OAUTH_METADATA = "/.well-known/oauth-authorization-server";

/** Parse LOOMBOARD_CONNECT_ORIGINS. The app compares a sender's origin to
 *  these strings exactly, so an entry that is not a bare origin (a trailing
 *  slash, a path) would never match and silently disable the handoff: refuse it
 *  instead, and the container fails at start with the reason. */
export function parseConnectOrigins(raw) {
  const origins = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const o of origins) {
    let parsed;
    try {
      parsed = new URL(o);
    } catch {
      parsed = null;
    }
    if (!parsed || !/^https?:$/.test(parsed.protocol) || parsed.origin !== o) {
      throw new Error(
        `LOOMBOARD_CONNECT_ORIGINS: "${o}" is not an origin (scheme://host[:port], no path or trailing slash)`,
      );
    }
  }
  return origins;
}

function proxied(pathname) {
  return pathname === "/v1" || pathname.startsWith("/v1/") || pathname === OAUTH_METADATA;
}

/** The server, unstarted. `upstream` is a URL string or empty. */
export function createServer({ root, upstream, connectOrigins }) {
  const ROOT = resolve(root);
  const UP = upstream ? new URL(upstream) : null;
  const request = UP?.protocol === "https:" ? https.request : http.request;
  // The origins were checked by parseConnectOrigins, so JSON.stringify yields a
  // plain data literal.
  const runtimeConfig = `window.__LOOMBOARD_CONFIG__ = ${JSON.stringify({ connectOrigins })};\n`;

  function proxy(req, res) {
    const headers = { ...req.headers, host: UP.host };
    delete headers["x-loomcycle-target"];
    const up = request(
      {
        protocol: UP.protocol,
        hostname: UP.hostname,
        port: UP.port || (UP.protocol === "https:" ? 443 : 80),
        path: req.url,
        method: req.method,
        headers,
      },
      (r) => {
        res.writeHead(r.statusCode || 502, r.headers);
        r.pipe(res);
      },
    );
    up.on("error", (err) => {
      // The code only: the path and headers can carry a sign-in code or a bearer.
      console.error(`loomboard: upstream error ${err.code || err.message}`);
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
      res.end("upstream error");
    });
    // An event stream lives until the browser leaves: let its upstream go too.
    res.on("close", () => up.destroy());
    req.pipe(up);
  }

  function send(req, res, file, cache) {
    const type = MIME[extname(file).toLowerCase()] || "application/octet-stream";
    const stream = createReadStream(file);
    stream.on("open", () => {
      res.writeHead(200, { "content-type": type, "cache-control": cache });
      if (req.method === "HEAD") {
        stream.destroy();
        res.end();
      } else {
        stream.pipe(res);
      }
    });
    stream.on("error", () => {
      if (!res.headersSent) res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    });
  }

  return http.createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url || "/", "http://x").pathname);
    } catch {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("bad request");
      return;
    }

    if (proxied(pathname)) {
      if (UP) return proxy(req, res);
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("no loomcycle upstream is configured");
      return;
    }

    // Everything below is the app itself. The connect handoff opens this app in
    // a new window, never a frame, so no page may frame it.
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("x-frame-options", "DENY");

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD", "content-type": "text/plain" });
      res.end("method not allowed");
      return;
    }
    if (pathname === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : "ok");
      return;
    }
    if (pathname === "/runtime-config.js") {
      res.writeHead(200, { "content-type": MIME[".js"], "cache-control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : runtimeConfig);
      return;
    }

    const target = resolve(ROOT, "." + pathname);
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("bad path");
      return;
    }
    const index = join(ROOT, "index.html");
    stat(target)
      .then((s) => {
        if (!s.isFile()) throw new Error("not a file");
        // Vite names every built asset by its content hash, so a name never
        // changes meaning; anything else may change with a deploy.
        const immutable = pathname.startsWith("/assets/");
        send(req, res, target, immutable ? "public, max-age=31536000, immutable" : "no-cache");
      })
      .catch(() => {
        // A missing hashed asset is a stale tab asking for the last deploy's
        // chunk: answering with index.html would only fail as a script.
        if (pathname.startsWith("/assets/")) {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("not found");
          return;
        }
        send(req, res, index, "no-cache");
      });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8080);
  const upstream = process.env.LOOMCYCLE_UPSTREAM || "";
  let connectOrigins;
  try {
    connectOrigins = parseConnectOrigins(process.env.LOOMBOARD_CONNECT_ORIGINS);
  } catch (err) {
    console.error(`loomboard: ${err.message}`);
    process.exit(1);
  }
  const server = createServer({
    root: process.env.SRV_ROOT || "/srv",
    upstream,
    connectOrigins,
  });
  server.listen(port, () => {
    console.log(
      `loomboard: serving on :${port}; /v1 -> ${upstream || "(none)"}; ` +
        `connect handoff from ${connectOrigins.length ? connectOrigins.join(", ") : "(none)"}`,
    );
  });
  // PID 1 in a container gets no default signal handling: without this, `docker
  // stop` waits out its timeout. Open event streams would hold close() forever,
  // so they are cut.
  const stop = () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}
