ARG NODE_IMAGE=node:24.22.1-bookworm-slim

FROM ${NODE_IMAGE} AS build

WORKDIR /usr/src/app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

# Download and verify Pixlet in a separate stage so curl never reaches the final image.
FROM ${NODE_IMAGE} AS pixlet

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*

ARG TARGETARCH=amd64
ARG PIXLET_VERSION=0.34.0
# Official sha256 checksums from https://github.com/tidbyt/pixlet/releases/download/v0.34.0/checksums.txt
# Update these together with PIXLET_VERSION.
ARG PIXLET_SHA256_AMD64=5833d0711803dd6374e696a5d02462f766b299df6413486021fb4035dcc54640
ARG PIXLET_SHA256_ARM64=b8c386179c1e5edfa0486e94f7f649ee0eed158ed479e015748faf8aa5246eae

RUN set -eux; \
  if [ "$TARGETARCH" = "arm64" ]; then ARCH="arm64"; SHA256="$PIXLET_SHA256_ARM64"; \
  else ARCH="amd64"; SHA256="$PIXLET_SHA256_AMD64"; fi; \
  PIXLET_URL="https://github.com/tidbyt/pixlet/releases/download/v${PIXLET_VERSION}/pixlet_${PIXLET_VERSION}_linux_${ARCH}.tar.gz"; \
  mkdir -p /tmp/pixlet; \
  curl -fsSL "$PIXLET_URL" -o /tmp/pixlet/pixlet.tar.gz; \
  echo "${SHA256}  /tmp/pixlet/pixlet.tar.gz" | sha256sum -c -; \
  tar -xzf /tmp/pixlet/pixlet.tar.gz -C /tmp/pixlet; \
  install -m 0755 /tmp/pixlet/pixlet /usr/local/bin/pixlet; \
  rm -rf /tmp/pixlet

FROM ${NODE_IMAGE}

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*

ENV PIXLET_BIN=pixlet

WORKDIR /usr/src/app
COPY --from=pixlet /usr/local/bin/pixlet /usr/local/bin/pixlet
COPY --from=build --chown=root:root /usr/src/app/dist ./dist

# Run as the unprivileged "node" user (uid 1000) shipped with the official image.
USER node

EXPOSE 8080
CMD ["node", "dist/index.js"]
