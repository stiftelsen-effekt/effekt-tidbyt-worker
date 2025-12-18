export type DonationEvent = {
  donationId: number;
  amount: number;
  timestamp: string;
};

export type BatchSnapshot = {
  count: number;
  sum: number;
};

type Waiter = {
  resolve: (snapshot: BatchSnapshot) => void;
  reject: (err: unknown) => void;
  cleanup?: () => void;
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
  private readonly waiters = new Set<Waiter>();

  constructor(
    private readonly opts: {
      batchWindowMs: number;
      maxBatchWaitMs: number;
      dedupeTtlMs: number;
      onFlush: (snapshot: BatchSnapshot) => Promise<void>;
    },
  ) {}

  enqueue(evt: DonationEvent) {
    void this.enqueueInternal(evt);
  }

  enqueueAndWait(evt: DonationEvent, signal?: AbortSignal): Promise<BatchSnapshot | null> {
    const accepted = this.enqueueInternal(evt);
    if (!accepted) return Promise.resolve(null);

    return new Promise<BatchSnapshot>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject };
      this.waiters.add(waiter);

      const onAbort = () => {
        this.waiters.delete(waiter);
        reject(new Error("request aborted"));
      };

      if (signal) {
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort, { once: true });
        waiter.cleanup = () => signal.removeEventListener("abort", onAbort);
      }
    });
  }

  private enqueueInternal(evt: DonationEvent): boolean {
    const now = Date.now();
    this.gc(now);

    const existing = this.seen.get(evt.donationId);
    if (existing && existing > now) return false;
    this.seen.set(evt.donationId, now + this.opts.dedupeTtlMs);

    const amount = Number(evt.amount);
    if (!Number.isFinite(amount) || amount <= 0) return false;

    if (this.firstAt == null) this.firstAt = now;
    this.lastAt = now;
    this.count += 1;
    this.sum += amount;

    this.scheduleFlush();
    return true;
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

  private snapshotAndReset(): { snapshot: BatchSnapshot; waiters: Waiter[] } {
    const snapshot = { count: this.count, sum: this.sum };
    const waiters = Array.from(this.waiters);
    this.waiters.clear();
    this.count = 0;
    this.sum = 0;
    this.firstAt = null;
    this.lastAt = null;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    return { snapshot, waiters };
  }

  private async flush() {
    if (this.flushing) return;
    if (this.count === 0) return;

    const { snapshot, waiters } = this.snapshotAndReset();
    this.flushing = true;
    try {
      await this.opts.onFlush(snapshot);
      for (const waiter of waiters) {
        waiter.cleanup?.();
        waiter.resolve(snapshot);
      }
    } catch (err) {
      for (const waiter of waiters) {
        waiter.cleanup?.();
        waiter.reject(err);
      }
      console.error("[tidbyt-worker] flush failed:", err);
    } finally {
      this.flushing = false;
    }
  }
}
