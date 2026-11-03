import http from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, discoverBaseUrl, parseBaseUrl, parseConnectOrigins } from "./serve.mjs";

function listen(server) {
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server.address().port)));
}

function get(port, path, headers = {}, method = "GET") {
  return new Promise((done, fail) => {
    const req = http.request({ host: "127.0.0.1", port, path, headers, method }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => done({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on("error", fail);
    req.end();
  });
}

// A stand-in runtime that records what reaches it.
function fakeRuntime(name) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ from: name }));
  });
  return { server, seen };
}

describe("serve.mjs", () => {
  let root;
  const runtime = fakeRuntime("pinned");
  const other = fakeRuntime("other");
  const servers = [];
  let port;
  let otherPort;
  let bare; // no upstream, no origins

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "loomboard-serve-"));
    writeFileSync(join(root, "index.html"), "<!doctype html><div id=root></div>");
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "assets", "index-abc123.js"), "console.log(1)");
    writeFileSync(join(root, "favicon.svg"), "<svg/>");

    const upPort = await listen(runtime.server);
    otherPort = await listen(other.server);
    const app = createServer({
      root,
      upstream: `http://127.0.0.1:${upPort}`,
      connectOrigins: ["https://loomcycle.cloud"],
    });
    port = await listen(app);
    const bareServer = createServer({ root, upstream: "", connectOrigins: [] });
    bare = await listen(bareServer);
    servers.push(runtime.server, other.server, app, bareServer);
  });

  afterAll(() => {
    for (const s of servers) s.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("proxies /v1 to the configured runtime only, never to the one the app names", async () => {
    const res = await get(port, "/v1/_me?x=1", {
      "x-loomcycle-target": `http://127.0.0.1:${otherPort}`,
      authorization: "Bearer test",
    });
    expect(JSON.parse(res.body)).toEqual({ from: "pinned" });
    expect(other.seen).toHaveLength(0);
    const hit = runtime.seen.at(-1);
    expect(hit.url).toBe("/v1/_me?x=1");
    expect(hit.headers.authorization).toBe("Bearer test");
    expect(hit.headers["x-loomcycle-target"]).toBeUndefined();
  });

  it("forwards the path it checked, so dot segments cannot step out of /v1", async () => {
    const before = runtime.seen.length;
    // Climbs out once resolved: the app answers, the runtime never sees it.
    for (const path of ["/v1/%2e%2e/%2e%2e/metrics", "/v1\\..\\..\\metrics", "/v1/../metrics"]) {
      const res = await get(port, path);
      expect(res.body).toContain("<div id=root>");
    }
    expect(runtime.seen.length).toBe(before);
    // Stays inside: the runtime gets the resolved path, not the one sent.
    await get(port, "/v1/runs/../_me");
    expect(runtime.seen.at(-1).url).toBe("/v1/_me");
  });

  it("keeps the encoded slashes the SDK puts in ids and paths", async () => {
    await get(port, "/v1/paths/%2Floomboard%2Fplans?depth=1");
    expect(runtime.seen.at(-1).url).toBe("/v1/paths/%2Floomboard%2Fplans?depth=1");
  });

  it("refuses a request target that is not a plain path", async () => {
    const before = runtime.seen.length;
    expect((await get(port, "//evil.example/v1/_me")).status).toBe(400);
    expect(runtime.seen.length).toBe(before);
  });

  it("proxies the OAuth metadata that sign-in reads from the root", async () => {
    const res = await get(port, "/.well-known/oauth-authorization-server");
    expect(JSON.parse(res.body)).toEqual({ from: "pinned" });
  });

  it("answers /v1 with 404, not the app, when no runtime is configured", async () => {
    const res = await get(bare, "/v1/_me");
    expect(res.status).toBe(404);
    expect(res.body).not.toContain("<div id=root>");
  });

  it("serves the configured connect origins as the runtime config, uncached", async () => {
    const res = await get(port, "/runtime-config.js");
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.headers["cache-control"]).toBe("no-store");
    const window = {};
    runInNewContext(res.body, { window });
    expect(window.__LOOMBOARD_CONFIG__).toEqual({ connectOrigins: ["https://loomcycle.cloud"] });
  });

  it("serves an empty origin list when none is configured", async () => {
    const window = {};
    runInNewContext((await get(bare, "/runtime-config.js")).body, { window });
    expect(window.__LOOMBOARD_CONFIG__).toEqual({ connectOrigins: [] });
  });

  it("serves the Base URL in the runtime config when one is given", async () => {
    const app = createServer({ root, upstream: "", connectOrigins: [], baseUrl: "https://loomcycle.example" });
    servers.push(app);
    const window = {};
    runInNewContext((await get(await listen(app), "/runtime-config.js")).body, { window });
    expect(window.__LOOMBOARD_CONFIG__).toEqual({ connectOrigins: [], baseUrl: "https://loomcycle.example" });
  });

  it("answers an unknown route with the app, uncached", async () => {
    const res = await get(port, "/boards/some-board");
    expect(res.status).toBe(200);
    expect(res.body).toContain("<div id=root>");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("caches hashed assets for good and 404s a missing one instead of sending the app", async () => {
    const hit = await get(port, "/assets/index-abc123.js");
    expect(hit.headers["cache-control"]).toContain("immutable");
    expect(hit.headers["content-type"]).toMatch(/javascript/);
    const miss = await get(port, "/assets/index-gone.js");
    expect(miss.status).toBe(404);
  });

  it("refuses a path that climbs out of the app directory", async () => {
    const res = await get(port, "/..%2f..%2fetc%2fpasswd");
    expect(res.status).toBe(400);
  });

  it("answers /healthz without touching the runtime", async () => {
    const before = runtime.seen.length;
    const res = await get(bare, "/healthz");
    expect(res.status).toBe(200);
    expect(runtime.seen.length).toBe(before);
  });

  it("closes the runtime's event stream when the browser goes away", async () => {
    let upstreamClosed;
    const closed = new Promise((done) => (upstreamClosed = done));
    const stream = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: hello\n\n");
      req.on("close", upstreamClosed);
    });
    const streamPort = await listen(stream);
    const app = createServer({ root, upstream: `http://127.0.0.1:${streamPort}`, connectOrigins: [] });
    const appPort = await listen(app);
    servers.push(stream, app);

    await new Promise((done) => {
      const req = http.get({ host: "127.0.0.1", port: appPort, path: "/v1/runs/x/events" }, (res) => {
        res.once("data", () => {
          req.destroy();
          done();
        });
      });
    });
    await expect(closed).resolves.toBeUndefined();
  });
});

describe("parseConnectOrigins", () => {
  it("returns [] when unset or blank", () => {
    expect(parseConnectOrigins(undefined)).toEqual([]);
    expect(parseConnectOrigins(" , ")).toEqual([]);
  });

  it("splits and trims a list of origins", () => {
    expect(parseConnectOrigins("https://loomcycle.cloud, http://localhost:3000 ")).toEqual([
      "https://loomcycle.cloud",
      "http://localhost:3000",
    ]);
  });

  // The app matches origins exactly, so these would never match a sender.
  it("refuses an entry that is not a bare origin", () => {
    expect(() => parseConnectOrigins("https://loomcycle.cloud/")).toThrow(/not an origin/);
    expect(() => parseConnectOrigins("https://loomcycle.cloud/app")).toThrow(/not an origin/);
    expect(() => parseConnectOrigins("loomcycle.cloud")).toThrow(/not an origin/);
    expect(() => parseConnectOrigins("javascript:alert(1)")).toThrow(/not an origin/);
  });
});

describe("parseBaseUrl", () => {
  it("returns null when unset or blank", () => {
    expect(parseBaseUrl(undefined)).toBeNull();
    expect(parseBaseUrl("  ")).toBeNull();
  });

  it("returns a bare origin, trimmed", () => {
    expect(parseBaseUrl(" https://loomcycle.example ")).toBe("https://loomcycle.example");
    expect(parseBaseUrl("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
  });

  // A sign-in's issuer is checked against this address, so these would make
  // every sign-in fail.
  it("refuses a value that is not a bare origin", () => {
    expect(() => parseBaseUrl("https://loomcycle.example/")).toThrow(/not an origin/);
    expect(() => parseBaseUrl("https://loomcycle.example/v1")).toThrow(/not an origin/);
    expect(() => parseBaseUrl("loomcycle.example")).toThrow(/not an origin/);
    expect(() => parseBaseUrl("ftp://loomcycle.example")).toThrow(/not an origin/);
  });
});

// A runtime that answers only the OAuth metadata, with the given issuer.
function metadataRuntime(issuer) {
  return http.createServer((req, res) => {
    if (req.url !== "/.well-known/oauth-authorization-server") {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ issuer, authorization_endpoint: `${issuer}/oauth/authorize` }));
  });
}

describe("discoverBaseUrl", () => {
  const servers = [];
  afterAll(() => {
    for (const s of servers) s.close();
  });
  async function upstreamWith(issuer) {
    const s = metadataRuntime(issuer);
    servers.push(s);
    return `http://127.0.0.1:${await listen(s)}`;
  }

  it("adopts the upstream's issuer", async () => {
    expect(await discoverBaseUrl(await upstreamWith("https://loomcycle.example"))).toBe(
      "https://loomcycle.example",
    );
  });

  it("ignores an issuer that is not a bare origin", async () => {
    expect(await discoverBaseUrl(await upstreamWith("https://loomcycle.example/tenant"))).toBeNull();
  });

  it("gives up, without throwing, when the upstream is unreachable or slow", async () => {
    const closed = http.createServer();
    const p = await listen(closed);
    closed.close();
    expect(await discoverBaseUrl(`http://127.0.0.1:${p}`, { timeoutMs: 500 })).toBeNull();
    const hang = http.createServer(() => {});
    servers.push(hang);
    expect(await discoverBaseUrl(`http://127.0.0.1:${await listen(hang)}`, { timeoutMs: 200 })).toBeNull();
  });
});

// The container's start-up, as `node serve.mjs` runs it: which Base URL it
// settles on, and that a bad one stops it.
describe("serve.mjs at start", () => {
  const serveFile = fileURLToPath(new URL("./serve.mjs", import.meta.url));
  const children = [];
  const servers = [];
  let root;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "loomboard-start-"));
    writeFileSync(join(root, "index.html"), "<!doctype html>");
  });
  afterAll(() => {
    for (const c of children) c.kill();
    for (const s of servers) s.close();
    rmSync(root, { recursive: true, force: true });
  });

  async function freePort() {
    const s = http.createServer();
    const p = await listen(s);
    await new Promise((done) => s.close(done));
    return p;
  }

  // Start serve.mjs with env; resolve with its port once it listens, or with
  // its exit code and stderr if it stops.
  function start(env) {
    return freePort().then(
      (p) =>
        new Promise((done) => {
          const child = spawn(process.execPath, [serveFile], {
            env: { PATH: process.env.PATH, SRV_ROOT: root, PORT: String(p), ...env },
          });
          children.push(child);
          let err = "";
          child.stdout.on("data", (d) => {
            if (String(d).includes("serving on")) done({ port: p });
          });
          child.stderr.on("data", (d) => (err += d));
          child.on("exit", (code) => done({ code, err }));
        }),
    );
  }

  async function configOf(port) {
    const window = {};
    runInNewContext((await get(port, "/runtime-config.js")).body, { window });
    return window.__LOOMBOARD_CONFIG__;
  }

  it("adopts the upstream's issuer when LOOMBOARD_BASE_URL is unset", async () => {
    const up = metadataRuntime("https://issuer.example");
    servers.push(up);
    const { port } = await start({ LOOMCYCLE_UPSTREAM: `http://127.0.0.1:${await listen(up)}` });
    expect((await configOf(port)).baseUrl).toBe("https://issuer.example");
  });

  it("prefers LOOMBOARD_BASE_URL over the upstream's issuer", async () => {
    const up = metadataRuntime("https://issuer.example");
    servers.push(up);
    const { port } = await start({
      LOOMCYCLE_UPSTREAM: `http://127.0.0.1:${await listen(up)}`,
      LOOMBOARD_BASE_URL: "https://public.example",
    });
    expect((await configOf(port)).baseUrl).toBe("https://public.example");
  });

  it("offers no Base URL with neither the variable nor an upstream", async () => {
    const { port } = await start({});
    expect(await configOf(port)).toEqual({ connectOrigins: [] });
  });

  it("refuses to start on a Base URL with a path", async () => {
    const r = await start({ LOOMBOARD_BASE_URL: "https://public.example/app" });
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/LOOMBOARD_BASE_URL: .* is not an origin/);
  });
});
