export type DonationEvent = {
  donationId: number;
  amount: number;
  timestamp: string;
};

export type BatchSnapshot = {
  count: number;
  sum: number;
};

export class Batcher {
  private count = 0;
  private sum = 0;
  private firstAt: number | null = null;
  private lastAt: number | null = null;
  private flushTimer: NodeJS.Timeout | null = null;
  private flushing = false;

  // naive in-memory dedupe to avoid repeated pushes on retries
  private readonly seen = new Map<number, number>();

  constructor(
    private readonly opts: {
      batchWindowMs: number;
      maxBatchWaitMs: number;
      dedupeTtlMs: number;
      onFlush: (snapshot: BatchSnapshot) => Promise<void>;
    },
  ) {}

  enqueue(evt: DonationEvent) {
    const now = Date.now();
    this.gc(now);

    const existing = this.seen.get(evt.donationId);
    if (existing && existing > now) return;
    this.seen.set(evt.donationId, now + this.opts.dedupeTtlMs);

    const amount = Number(evt.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;

    if (this.firstAt == null) this.firstAt = now;
    this.lastAt = now;
    this.count += 1;
    this.sum += amount;

    this.scheduleFlush();
  }

  private gc(now: number) {
    for (const [id, until] of this.seen) {
      if (until <= now) this.seen.delete(id);
    }
  }

  private scheduleFlush() {
    if (this.firstAt == null || this.lastAt == null) return;

    const windowDue = this.lastAt + Math.max(250, this.opts.batchWindowMs);
    const maxDue = this.firstAt + Math.max(1000, this.opts.maxBatchWaitMs);
    const dueAt = Math.min(windowDue, maxDue);
    const delay = Math.max(0, dueAt - Date.now());

    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => void this.flush(), delay);
  }

  private snapshotAndReset(): BatchSnapshot {
    const snapshot = { count: this.count, sum: this.sum };
    this.count = 0;
    this.sum = 0;
    this.firstAt = null;
    this.lastAt = null;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    return snapshot;
  }

  private async flush() {
    if (this.flushing) return;
    if (this.count === 0) return;

    const snapshot = this.snapshotAndReset();
    this.flushing = true;
    try {
      await this.opts.onFlush(snapshot);
    } catch (err) {
      console.error("[tidbyt-worker] flush failed:", err);
    } finally {
      this.flushing = false;
    }
  }
}

