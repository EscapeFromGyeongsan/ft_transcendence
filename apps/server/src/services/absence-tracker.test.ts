import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAbsenceTracker } from "./absence-tracker.ts";

function setup() {
  const notify = vi.fn();
  const onExpire = vi.fn();
  const tracker = createAbsenceTracker({ budgetMs: 60_000, notify, onExpire });
  return { tracker, notify, onExpire };
}

describe("absence tracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("a player who never connects expires after the budget", () => {
    const { tracker, onExpire } = setup();
    tracker.track(1, [10, 20]);
    tracker.connect(1, 20);

    vi.advanceTimersByTime(59_999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledExactlyOnceWith(1, [10]);
  });

  test("connected players never expire", () => {
    const { tracker, onExpire, notify } = setup();
    tracker.track(1, [10, 20]);
    tracker.connect(1, 10);
    tracker.connect(1, 20);
    vi.advanceTimersByTime(600_000);
    expect(onExpire).not.toHaveBeenCalled();
    // The first connection is not a reconnect.
    expect(notify).not.toHaveBeenCalled();
  });

  test("absence time accumulates across disconnects", () => {
    const { tracker, notify, onExpire } = setup();
    tracker.track(1, [10, 20]);
    tracker.connect(1, 10);
    tracker.connect(1, 20);

    tracker.disconnect(1, 10);
    expect(notify).toHaveBeenLastCalledWith(1, "player.disconnected", {
      matchId: 1,
      userId: 10,
      remainingMs: 60_000,
    });
    vi.advanceTimersByTime(30_000);
    tracker.connect(1, 10);
    expect(notify).toHaveBeenLastCalledWith(1, "player.reconnected", {
      matchId: 1,
      userId: 10,
      remainingMs: 30_000,
    });

    tracker.disconnect(1, 10);
    vi.advanceTimersByTime(29_999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledExactlyOnceWith(1, [10]);
  });

  test("time before a heartbeat noticed the loss counts as absence", () => {
    const { tracker, notify, onExpire } = setup();
    tracker.track(1, [10, 20]);
    tracker.connect(1, 10);
    tracker.connect(1, 20);

    vi.advanceTimersByTime(20_000);
    tracker.disconnect(1, 10, 5_000);
    expect(notify).toHaveBeenLastCalledWith(
      1,
      "player.disconnected",
      expect.objectContaining({ remainingMs: 45_000 }),
    );
    vi.advanceTimersByTime(44_999);
    expect(onExpire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onExpire).toHaveBeenCalledOnce();
  });

  test("a user with another open connection is not absent", () => {
    const { tracker, notify } = setup();
    tracker.track(1, [10, 20]);
    tracker.connect(1, 10);
    tracker.connect(1, 10);
    tracker.disconnect(1, 10);
    expect(notify).not.toHaveBeenCalled();
    expect(tracker.remainingMs(1, 10)).toBe(60_000);
  });

  test("everyone absent at expiry is reported, and timers stop", () => {
    const { tracker, onExpire } = setup();
    tracker.track(1, [10, 20]);
    tracker.connect(1, 10);
    tracker.connect(1, 20);
    tracker.disconnect(1, 10);
    vi.advanceTimersByTime(10_000);
    tracker.disconnect(1, 20);

    vi.advanceTimersByTime(50_000);
    expect(onExpire).toHaveBeenCalledExactlyOnceWith(1, [10, 20]);
    vi.advanceTimersByTime(60_000);
    expect(onExpire).toHaveBeenCalledOnce();
  });

  test("finish stops tracking; untracked matches are ignored", () => {
    const { tracker, notify, onExpire } = setup();
    tracker.track(1, [10, 20]);
    tracker.finish(1);
    vi.advanceTimersByTime(120_000);
    expect(onExpire).not.toHaveBeenCalled();

    tracker.connect(2, 10);
    tracker.disconnect(2, 10);
    expect(notify).not.toHaveBeenCalled();
    expect(tracker.remainingMs(2, 10)).toBeUndefined();
  });

  test("tracking the same match again keeps the existing clocks", () => {
    const { tracker, onExpire } = setup();
    tracker.track(1, [10, 20]);
    vi.advanceTimersByTime(30_000);
    tracker.track(1, [10, 20]);
    vi.advanceTimersByTime(30_000);
    expect(onExpire).toHaveBeenCalledOnce();
  });
});
