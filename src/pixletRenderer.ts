import { spawn } from "child_process";

export type PixletRenderOptions = {
  pixletBin: string;
  scriptPath: string;
  config: Record<string, string>;
  timeoutMs?: number;
};

export async function pixletRenderWebP({
  pixletBin,
  scriptPath,
  config,
  timeoutMs = 30_000,
}: PixletRenderOptions): Promise<Buffer> {
  const args = ["render", "--output", "-", "--silent", "--timeout", String(timeoutMs), scriptPath];
  for (const [key, value] of Object.entries(config)) {
    args.push(`${key}=${value}`);
  }

  return await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(pixletBin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (d) => stdout.push(Buffer.from(d)));
    child.stderr.on("data", (d) => stderr.push(Buffer.from(d)));
    child.on("error", reject);
    child.on("close", (code) => {
      const errText = Buffer.concat(stderr).toString("utf8").trim();
      if (code !== 0) return reject(new Error(`pixlet exited ${code}: ${errText || "(no stderr)"}`));
      const out = Buffer.concat(stdout);
      if (out.length === 0) return reject(new Error(`pixlet returned empty output: ${errText}`));
      resolve(out);
    });
  });
}
