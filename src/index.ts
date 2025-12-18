import http from "http";
import { readFileSync } from "fs";
import path from "path";
import { Batcher } from "./batcher";
import { pixletRenderWebP } from "./pixletRenderer";
import { pushToTidbyt } from "./tidbytClient";

const port = Number(process.env.PORT || "8080");

const authToken = process.env.TIDBYT_WORKER_AUTH_TOKEN || "";
const tidbytApiKey = process.env.TIDBYT_API_KEY || "";
const tidbytDeviceId = process.env.TIDBYT_DEVICE_ID || "";
const installationIdEnv = String(process.env.TIDBYT_INSTALLATION_ID || "").trim();
const installationId =
  installationIdEnv && /^[a-zA-Z0-9]+$/.test(installationIdEnv) ? installationIdEnv : undefined;
const installationIdInvalid = Boolean(installationIdEnv) && !installationId;
const background = (process.env.TIDBYT_PUSH_BACKGROUND || "false") === "true";
const tidbytPushTimeoutMsRaw = Number(process.env.TIDBYT_PUSH_TIMEOUT_MS || "30000");
const tidbytPushTimeoutMs = Number.isFinite(tidbytPushTimeoutMsRaw) ? tidbytPushTimeoutMsRaw : 30_000;

const pixletBin = process.env.PIXLET_BIN || "pixlet";
const appletPath =
  process.env.TIDBYT_PIXLET_APPLET || path.join(__dirname, "applets", "donation_alert.star");
const pixletTimeoutMsRaw = Number(process.env.PIXLET_RENDER_TIMEOUT_MS || "30000");
const pixletTimeoutMs = Number.isFinite(pixletTimeoutMsRaw) ? pixletTimeoutMsRaw : 30_000;

const batchWindowMs = Number(process.env.TIDBYT_BATCH_WINDOW_MS || "8000");
const maxBatchWaitMs = Number(process.env.TIDBYT_MAX_BATCH_WAIT_MS || "60000");
const countryCode = (process.env.EFFEKT_COUNTRY_CODE || "??").toUpperCase();
const waitForFlush = (process.env.TIDBYT_WAIT_FOR_FLUSH || "true") === "true";

const batcher = new Batcher({
  batchWindowMs,
  maxBatchWaitMs,
  dedupeTtlMs: 60 * 60 * 1000,
  onFlush: async ({ count, sum }) => {
    if (!tidbytApiKey || !tidbytDeviceId) return;
    const image = await pixletRenderWebP({
      pixletBin,
      scriptPath: appletPath,
      timeoutMs: pixletTimeoutMs,
      config: {
        count: String(count),
        sum: String(Math.round(sum)),
        country: countryCode,
        currency: "kr",
      },
    });

    if (image.byteLength > 192 * 1024) {
      throw new Error(`Rendered WebP too large (${image.byteLength} bytes)`);
    }

    await pushToTidbyt({
      apiKey: tidbytApiKey,
      deviceId: tidbytDeviceId,
      image,
      installationId,
      background,
      timeoutMs: tidbytPushTimeoutMs,
    });
  },
});

function json(res: http.ServerResponse, code: number, body: any) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": data.length });
  res.end(data);
}

function unauthorized(res: http.ServerResponse) {
  json(res, 401, { ok: false });
}

function notFound(res: http.ServerResponse) {
  json(res, 404, { ok: false });
}

function badRequest(res: http.ServerResponse) {
  json(res, 400, { ok: false });
}

function requireAuth(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (!authToken) return true;
  const header = req.headers["authorization"] || "";
  if (header !== `Bearer ${authToken}`) {
    unauthorized(res);
    return false;
  }
  return true;
}

const server = http.createServer((req, res) => {
  const url = req.url || "/";
  if (req.method === "GET" && url === "/") {
    return json(res, 200, {
      ok: true,
      endpoints: {
        healthz: "/healthz",
        donationsConfirmed: "/donations/confirmed",
      },
      configured: {
        tidbytApiKey: Boolean(tidbytApiKey),
        tidbytDeviceId: Boolean(tidbytDeviceId),
        workerAuthEnabled: Boolean(authToken),
        installationId: Boolean(installationId),
        installationIdInvalid,
      },
      countryCode,
    });
  }
  if (req.method === "GET" && url === "/healthz") return json(res, 200, { ok: true });

  if (req.method === "POST" && url === "/donations/confirmed") {
    if (!requireAuth(req, res)) return;

    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", async () => {
      let body: any;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        return badRequest(res);
      }

      const donationId = Number(body?.donationId);
      const amount = Number(body?.amount);
      const timestamp = String(body?.timestamp || new Date().toISOString());

      if (!Number.isFinite(donationId) || donationId <= 0) return badRequest(res);
      if (!Number.isFinite(amount) || amount <= 0) return badRequest(res);

      const evt = { donationId, amount, timestamp };
      if (!waitForFlush) {
        batcher.enqueue(evt);
        return json(res, 200, { ok: true });
      }

      const controller = new AbortController();
      req.on("close", () => controller.abort());
      try {
        const snapshot = await batcher.enqueueAndWait(evt, controller.signal);
        if (res.writableEnded) return;
        return json(res, 200, { ok: true, flushed: snapshot });
      } catch {
        if (res.writableEnded) return;
        return json(res, 500, { ok: false });
      }
    });
    return;
  }

  notFound(res);
});

server.listen(port, () => {
  console.log(`[tidbyt-worker] Listening on :${port}`);
  console.log(`[tidbyt-worker] applet=${appletPath} pixlet=${pixletBin}`);
  console.log(`[tidbyt-worker] pixlet timeout=${pixletTimeoutMs}ms tidbyt timeout=${tidbytPushTimeoutMs}ms`);
  if (installationIdInvalid) {
    console.warn(
      `[tidbyt-worker] TIDBYT_INSTALLATION_ID is invalid (must be alphanumeric), omitting it from push`,
    );
  } else if (installationId) {
    console.log(`[tidbyt-worker] installationId=${installationId} background=${background}`);
  }
  console.log(`[tidbyt-worker] batching window=${batchWindowMs}ms max=${maxBatchWaitMs}ms`);
});
