FROM node:18-slim AS build

WORKDIR /usr/src/app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:18-slim

RUN apt-get update && apt-get install -y ca-certificates curl && rm -rf /var/lib/apt/lists/*

ARG TARGETARCH=amd64
ARG PIXLET_VERSION=0.34.0
ENV PIXLET_BIN=pixlet

WORKDIR /usr/src/app
COPY --from=build /usr/src/app/dist ./dist

# Download Pixlet (Linux). You may want to pin to a specific version instead of "latest".
RUN set -eux; \
  if [ "$TARGETARCH" = "arm64" ]; then ARCH="arm64"; else ARCH="amd64"; fi; \
  PIXLET_URL="https://github.com/tidbyt/pixlet/releases/download/v${PIXLET_VERSION}/pixlet_${PIXLET_VERSION}_linux_${ARCH}.tar.gz"; \
  mkdir -p /tmp/pixlet; \
  curl -fsSL "$PIXLET_URL" -o /tmp/pixlet/pixlet.tar.gz; \
  tar -xzf /tmp/pixlet/pixlet.tar.gz -C /tmp/pixlet; \
  mv /tmp/pixlet/pixlet /usr/local/bin/pixlet; \
  chmod +x /usr/local/bin/pixlet; \
  rm -rf /tmp/pixlet

EXPOSE 8080
CMD ["node", "dist/index.js"]
