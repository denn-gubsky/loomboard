# syntax=docker/dockerfile:1
# The hosted loomboard: the standalone SPA served by serve.mjs, which also
# proxies /v1 to one loomcycle runtime. Configured at start from the
# environment (see serve.mjs), so one image serves any deployment.
#
# Build from the repository root:
#   docker build -f docker/Dockerfile -t loomboard .

# The bundle is the same on every platform, so it is built once on the
# builder's own platform rather than under emulation for each target.
FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/workflow/package.json packages/workflow/
RUN npm ci
COPY . .
# Without .env.standalone the build still succeeds, but the app then calls the
# runtime directly instead of through this server and fails on CORS.
RUN test -f .env.standalone && npm run build:standalone

FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 SRV_ROOT=/srv
COPY --from=build /app/cli/public /srv
COPY docker/serve.mjs /serve.mjs
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "/serve.mjs"]
