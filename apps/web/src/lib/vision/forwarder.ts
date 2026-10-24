/**
 * Sends camera events to the server one at a time, in order. Never loses an event silently:
 * every event ends as "sent", "duplicate", "failed" (server rejected it) or "dropped" (the
 * bounded queue overflowed while offline), and each state is visible in the UI.
 */

export type ForwardStatus = "queued" | "sending" | "sent" | "failed" | "dropped";

export type SendResult =
  | { ok: true }
  | { ok: false; retry: boolean; message: string };

export type ForwarderOptions = {
  maxQueue?: number;
  backoffMs?: number[];
  setTimer?: (fn: () => void, ms: number) => unknown;
};

type Item<T> = { id: string; payload: T; attempts: number };

export class EventForwarder<T> {
  private queue: Item<T>[] = [];
  private busy = false;
  private waiting = false; // backing off before a retry
  private stopped = false;
  private readonly maxQueue: number;
  private readonly backoffMs: number[];
  private readonly setTimer: (fn: () => void, ms: number) => unknown;

  constructor(
    private readonly send: (payload: T) => Promise<SendResult>,
    private readonly onStatus: (id: string, status: ForwardStatus, message?: string) => void,
    options: ForwarderOptions = {},
  ) {
    this.maxQueue = options.maxQueue ?? 50;
    this.backoffMs = options.backoffMs ?? [1000, 2000, 5000, 10_000];
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  }

  get pending(): number {
    return this.queue.length;
  }

  enqueue(id: string, payload: T): void {
    if (this.stopped) {
      this.onStatus(id, "dropped", "forwarding stopped");
      return;
    }
    if (this.queue.length >= this.maxQueue) {
      const oldest = this.busy ? this.queue.splice(1, 1)[0] : this.queue.shift();
      if (oldest) this.onStatus(oldest.id, "dropped", "queue full while the server was unreachable");
    }
    this.queue.push({ id, payload, attempts: 0 });
    this.onStatus(id, "queued");
    void this.pump();
  }

  /** Stops sending; anything still queued is reported as dropped. */
  stop(): void {
    this.stopped = true;
    for (const item of this.queue.splice(0)) this.onStatus(item.id, "dropped", "forwarding stopped");
  }

  private async pump(): Promise<void> {
    if (this.busy || this.waiting || this.stopped) return;
    const item = this.queue[0];
    if (!item) return;
    this.busy = true;
    this.onStatus(item.id, "sending");
    let result: SendResult;
    try {
      result = await this.send(item.payload);
    } catch (err) {
      result = { ok: false, retry: true, message: err instanceof Error ? err.message : String(err) };
    }
    this.busy = false;
    if (this.stopped) return;
    if (result.ok) {
      this.queue.shift();
      this.onStatus(item.id, "sent");
      void this.pump();
      return;
    }
    if (!result.retry || item.attempts >= this.backoffMs.length) {
      this.queue.shift();
      this.onStatus(item.id, "failed", result.message);
      void this.pump();
      return;
    }
    const delay = this.backoffMs[item.attempts];
    item.attempts += 1;
    this.onStatus(item.id, "queued", `retrying in ${Math.round(delay / 1000)}s: ${result.message}`);
    this.waiting = true;
    this.setTimer(() => {
      this.waiting = false;
      void this.pump();
    }, delay);
  }
}
