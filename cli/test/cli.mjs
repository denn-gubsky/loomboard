// Runs the CLI as a user would and checks what its two dependencies do for it:
// sirv serves the SPA (with history fallback), http-proxy-middleware sends /v1
// and the OAuth metadata to loomcycle. A bump of either that changed this
// fails here, before a release. Needs the built app: npm run build:standalone
// at the repo root, then npm test here.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../bin/loomboard.mjs", import.meta.url));
const built = fileURLToPath(new URL("../public/index.html", import.meta.url));

function freePort() {
  return new Promise((done) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => done(port));
    });
  });
}

function get(port, path, headers = {}) {
  return new Promise((done, fail) => {
    const req = http.get({ host: "127.0.0.1", port, path, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (body += c));
      res.on("end", () => done({ status: res.statusCode, body }));
    });
    req.on("error", fail);
  });
}

// A stand-in loomcycle that says which one it is and what path it got.
function fakeRuntime(name) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ from: name, url: req.url }));
  });
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () => done({ server, url: `http://127.0.0.1:${server.address().port}` })),
  );
}

let cli;
let port;
let runtime;
let other;

before(async () => {
  assert.ok(existsSync(built), "cli/public is not built: run `npm run build:standalone` at the repo root");
  runtime = await fakeRuntime("default");
  other = await fakeRuntime("named");
  port = await freePort();
  cli = spawn(process.execPath, [bin, "--port", String(port), "--no-open", "--loomcycle", runtime.url], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((done, fail) => {
    let out = "";
    const timer = setTimeout(() => fail(new Error(`the CLI did not start:\n${out}`)), 10000);
    const onData = (c) => {
      out += c;
      if (out.includes("Ctrl+C to stop")) {
        clearTimeout(timer);
        done();
      }
    };
    cli.stdout.on("data", onData);
    cli.stderr.on("data", onData);
    cli.on("exit", (code) => fail(new Error(`the CLI exited (${code}):\n${out}`)));
  });
});

after(() => {
  cli?.kill();
  runtime?.server.close();
  other?.server.close();
});

test("serves the app at / and at any other route", async () => {
  for (const path of ["/", "/some/route"]) {
    const res = await get(port, path);
    assert.equal(res.status, 200, path);
    assert.match(res.body, /<div id="root"><\/div>/, path);
  }
});

test("proxies /v1 to the default loomcycle, path and query intact", async () => {
  const res = await get(port, "/v1/paths/%2Fa%2Fb?depth=1");
  assert.deepEqual(JSON.parse(res.body), { from: "default", url: "/v1/paths/%2Fa%2Fb?depth=1" });
});

test("proxies /v1 to the loomcycle the connection screen names", async () => {
  const res = await get(port, "/v1/_me", { "x-loomcycle-target": other.url });
  assert.equal(JSON.parse(res.body).from, "named");
});

test("proxies the OAuth metadata that sign-in reads from the root", async () => {
  const res = await get(port, "/.well-known/oauth-authorization-server");
  assert.equal(JSON.parse(res.body).from, "default");
});

// The DNS-rebinding guard: bound to loopback, a foreign Host is refused.
test("refuses a request whose Host is not a loopback name", async () => {
  const res = await get(port, "/v1/_me", { host: "evil.example" });
  assert.equal(res.status, 403);
});
