import { describe, expect, it, vi } from "vitest";
import { EventForwarder, type ForwardStatus, type SendResult } from "@/lib/vision/forwarder";

function harness(results: (SendResult | Error)[], maxQueue = 50) {
  const statuses: [string, ForwardStatus, string | undefined][] = [];
  const timers: (() => void)[] = [];
  const send = vi.fn<(payload: string) => Promise<SendResult>>(async () => {
    const r = results.shift() ?? { ok: true };
    if (r instanceof Error) throw r;
    return r;
  });
  const f = new EventForwarder<string>(send, (id, s, m) => statuses.push([id, s, m]), {
    maxQueue,
    backoffMs: [10, 20],
    setTimer: (fn) => timers.push(fn),
  });
  const final = (id: string) => statuses.filter(([i]) => i === id).at(-1)?.[1];
  const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  const runTimers = async () => {
    while (timers.length) {
      timers.shift()!();
      await flush();
    }
  };
  return { f, send, statuses, final, flush, runTimers };
}

describe("EventForwarder", () => {
  it("sends events in order", async () => {
    const h = harness([]);
    h.f.enqueue("a", "A");
    h.f.enqueue("b", "B");
    await h.flush();
    expect(h.send.mock.calls.map((c) => c[0])).toEqual(["A", "B"]);
    expect([h.final("a"), h.final("b")]).toEqual(["sent", "sent"]);
  });

  it("retries network failures with backoff, then succeeds", async () => {
    const h = harness([new Error("offline"), { ok: true }]);
    h.f.enqueue("a", "A");
    await h.flush();
    expect(h.final("a")).toBe("queued");
    await h.runTimers();
    expect(h.final("a")).toBe("sent");
    expect(h.send).toHaveBeenCalledTimes(2);
  });

  it("marks an event failed when the server rejects it, and moves on", async () => {
    const h = harness([{ ok: false, retry: false, message: "422 invalid" }]);
    h.f.enqueue("a", "A");
    h.f.enqueue("b", "B");
    await h.flush();
    expect(h.final("a")).toBe("failed");
    expect(h.final("b")).toBe("sent");
  });

  it("gives up after the retry budget and reports failure", async () => {
    const h = harness([new Error("x"), new Error("x"), new Error("x")]);
    h.f.enqueue("a", "A");
    await h.flush();
    await h.runTimers();
    expect(h.final("a")).toBe("failed");
  });

  it("drops the oldest waiting event when the bounded queue overflows, visibly", async () => {
    const h = harness([new Error("offline")], 2);
    h.f.enqueue("a", "A"); // in flight, then waiting for retry
    await h.flush();
    h.f.enqueue("b", "B");
    h.f.enqueue("c", "C"); // queue full -> drop oldest waiting (a)
    expect(h.final("a")).toBe("dropped");
    await h.runTimers();
    expect([h.final("b"), h.final("c")]).toEqual(["sent", "sent"]);
  });

  it("reports everything still queued as dropped when stopped", async () => {
    const h = harness([new Error("offline")]);
    h.f.enqueue("a", "A");
    await h.flush();
    h.f.stop();
    expect(h.final("a")).toBe("dropped");
    h.f.enqueue("b", "B");
    expect(h.final("b")).toBe("dropped");
  });
});
