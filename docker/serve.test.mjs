import http from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, parseConnectOrigins } from "./serve.mjs";

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
