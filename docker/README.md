# loomboard in Docker

The hosted loomboard as one container: the app, plus a proxy that sends its
`/v1` calls to your loomcycle runtime (loomcycle sends no CORS headers, so the
browser has to reach it through the app's own origin).

```
docker run -p 8080:8080 -e LOOMCYCLE_UPSTREAM=http://loomcycle:8787 denngubsky/loomboard:<version>
```

Images are published for linux/amd64 and linux/arm64 on every `v*` release
tag, as `denngubsky/loomboard` and `ghcr.io/denn-gubsky/loomboard`.

## Configuration

All of it is read when the container starts; nothing is built in.

| Variable | Default | What it does |
|---|---|---|
| `LOOMCYCLE_UPSTREAM` | none | The runtime `/v1` and `/.well-known/oauth-authorization-server` go to. Fixed: the app's `x-loomcycle-target` header is dropped, so the container is never an open proxy. Unset, the container serves the app alone and answers `/v1` with 404, for a deployment that routes `/v1` to the runtime itself. |
| `LOOMBOARD_CONNECT_ORIGINS` | none | Comma-separated origins allowed to hand the app a bearer by `postMessage` (`{type:'loomboard.connect', token}`), e.g. a landing page that already holds it. Each must be a bare origin, `https://example.com`: anything else stops the container at start. Unset, no page can. |
| `PORT` | `8080` | Listen port. |

The bearer is entered in the app (or handed to it as above) and lives in the
browser; the container never reads or stores it.

## Docker Compose, next to loomcycle

```yaml
services:
  loomboard:
    image: denngubsky/loomboard:<version>
    restart: unless-stopped
    read_only: true
    environment:
      LOOMCYCLE_UPSTREAM: http://loomcycle:8787
    ports:
      - "8080:8080"
```

The image has a `HEALTHCHECK` on `/healthz`, which answers without calling the
runtime.

## Build it yourself

From the repository root:

```
docker build -f docker/Dockerfile -t loomboard .
```

The build context is an allowlist (`.dockerignore`), so no local `.env*.local`
file is sent to the builder.
