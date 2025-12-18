export type TidbytPushOptions = {
  apiKey: string;
  deviceId: string;
  image: Buffer;
  installationId?: string;
  background?: boolean;
  timeoutMs?: number;
};

export async function pushToTidbyt({
  apiKey,
  deviceId,
  image,
  installationId,
  background,
  timeoutMs = 30_000,
}: TidbytPushOptions): Promise<void> {
  const url = `https://api.tidbyt.com/v0/devices/${encodeURIComponent(deviceId)}/push`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        image: image.toString("base64"),
        installationID: installationId,
        background: background && !!installationId,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Tidbyt push failed (${res.status}): ${text || res.statusText}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
