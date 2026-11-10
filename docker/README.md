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
| `LOOMBOARD_BASE_URL` | the upstream's OAuth issuer | The loomcycle address people sign in to (its `LOOMCYCLE_PUBLIC_URL`). The sign-in screen starts with it filled in, and a blank field means it. Must be a bare origin, `https://loomcycle.example.com`: anything else stops the container at start. Unset, the container reads the issuer from `LOOMCYCLE_UPSTREAM`'s `/.well-known/oauth-authorization-server` at start and logs what it adopted; with neither, people type the address. |
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
      # The address people sign in to; unset, the upstream's issuer is used.
      LOOMBOARD_BASE_URL: https://loomcycle.example.com
    ports:
      - "8080:8080"
```

The image has a `HEALTHCHECK` on `/healthz`, which answers without calling the
runtime.

## HTTPS for voice input

Browsers open the microphone only on a secure page: `https://`, or
`http://localhost`. The container serves plain HTTP, so opened as
`http://<host>:8080` from another machine the chat's mic is shown disabled with
"Voice input needs HTTPS (or localhost)". Read-aloud works either way. Put TLS
in front of the container:

- **Caddy**, with a public DNS name pointing at the host (it gets and renews the
  certificate itself):

  ```yaml
  services:
    loomboard:
      image: denngubsky/loomboard:<version>
      environment:
        LOOMCYCLE_UPSTREAM: http://loomcycle:8787
    caddy:
      image: caddy:2
      restart: unless-stopped
      command: caddy reverse-proxy --from board.example.com --to loomboard:8080
      ports:
        - "80:80"
        - "443:443"
      volumes:
        - caddy_data:/data
  volumes:
    caddy_data:
  ```

- **Tailscale**, for a host on your tailnet with no public name:
  `tailscale serve --bg 8080` serves it at `https://<machine>.<tailnet>.ts.net`.

- Any other reverse proxy that terminates TLS and forwards to port 8080 works the
  same way; the container needs no TLS settings of its own.

Then add the `https://` address to loomcycle's `auth.clients.loomboard`
(`redirect_uris` and `allowed_origins`, see the main README's "Sign in with
loomcycle"), since sign-in checks the origin people open the app on.

## Build it yourself

From the repository root:

```
docker build -f docker/Dockerfile -t loomboard .
```

The build context is an allowlist (`.dockerignore`), so no local `.env*.local`
file is sent to the builder.
