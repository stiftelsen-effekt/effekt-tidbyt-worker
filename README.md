# Effekt Tidbyt Worker

Tiny Cloud Run-friendly service that:

1. Receives donation events over HTTP
2. Batches them for a short window
3. Renders a Pixlet/Starlark animation
4. Pushes the rendered WebP to a Tidbyt device

This folder is intended to be its own repo. You can move it out of the backend repo and `git init` it.

## Endpoints

- `GET /` (basic status/config)
- `GET /healthz`
- `POST /donations/confirmed` (expects JSON: `{ donationId, amount, timestamp }`) — by default this waits until the batch flush completes (render+push) before responding.

If `TIDBYT_WORKER_AUTH_TOKEN` is set, requests must include `Authorization: Bearer <token>`.

## Config

See `.env.example`.

### Device ID vs installation ID

- `TIDBYT_DEVICE_ID` identifies which Tidbyt device to push to (required).
- `TIDBYT_INSTALLATION_ID` is optional; the worker only includes it in the Tidbyt API request when `TIDBYT_PUSH_BACKGROUND=true`.
  - Tidbyt requires `installationID` to be alphanumeric; the worker will sanitize the value by stripping non-alphanumeric characters.
  - For ephemeral “show once” alerts, keep `TIDBYT_PUSH_BACKGROUND=false` (default) and you can leave `TIDBYT_INSTALLATION_ID` unset.

## Local render test (requires Pixlet installed)

```sh
pixlet render src/applets/donation_alert.star count=1 sum=250 country=NO
```

## Run locally

```sh
npm install
npm run dev
```

## Deploy

The included `Dockerfile` builds the worker and downloads the `pixlet` binary in the image.

If rendering ever times out on Cloud Run, increase `PIXLET_RENDER_TIMEOUT_MS` (defaults to `30000`).
If pushing ever times out, increase `TIDBYT_PUSH_TIMEOUT_MS` (defaults to `30000`).

### Cloud Run CPU allocation

This service batches via timers. If you set `TIDBYT_WAIT_FOR_FLUSH=true` (default), the request stays open until flush completes, which makes it work even when Cloud Run is set to "CPU is only allocated during request handling".

If you set `TIDBYT_WAIT_FOR_FLUSH=false` (fire-and-forget responses), you typically need "CPU always allocated" for the batch timer to run reliably.

### Batching + dedupe semantics

- **Batching:** each event contributes to an in-memory batch. A flush is scheduled for `lastEventAt + TIDBYT_BATCH_WINDOW_MS` (with a small minimum delay), but never later than `firstEventAt + TIDBYT_MAX_BATCH_WAIT_MS`.
- **Dedupe:** `donationId` is cached in-memory for 1 hour. Re-sending the same `donationId` within that window returns `{"ok":true,"deduped":true}` and does not trigger another push.

### Option A: `gcloud run deploy` (manual)

```sh
gcloud run deploy effekt-tidbyt-worker \
  --region europe-north1 \
  --source . \
  --allow-unauthenticated
```

Then set runtime configuration (recommended via Secret Manager):

```sh
gcloud run services update effekt-tidbyt-worker \
  --region europe-north1 \
  --set-env-vars EFFEKT_COUNTRY_CODE=NO,TIDBYT_BATCH_WINDOW_MS=8000,TIDBYT_MAX_BATCH_WAIT_MS=60000,TIDBYT_WORKER_AUTH_TOKEN=... \
  --set-secrets TIDBYT_API_KEY=tidbyt-api-key:latest \
  --set-env-vars TIDBYT_DEVICE_ID=... \
```

### Option B: Cloud Build (recommended)

`cloudbuild.yaml` builds an image to Artifact Registry and deploys to Cloud Run.

1. Create an Artifact Registry repo (once):
   - `gcloud artifacts repositories create effekt --repository-format=docker --location=europe-north1`
2. Submit a build:
   - `gcloud builds submit --config cloudbuild.yaml --substitutions=_SERVICE=effekt-tidbyt-worker-no,_REGION=europe-north1,_AR_REPO=effekt`

After the service exists, set secrets/env vars as in Option A.
