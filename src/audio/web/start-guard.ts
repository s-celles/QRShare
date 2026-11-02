/**
 * Guards asynchronous starts of microphone capture / speaker playback against UI
 * races: a second start while one is pending is ignored (double tap, autostart +
 * tap), and a resource that finishes starting after a stop or an unmount is
 * released immediately instead of leaking (mic, AudioContext, scheduled audio).
 */
export class StartGuard {
  private generation = 0;
  private starting = false;
  private disposed = false;

  /** Starts an attempt; null when one is already pending or the owner is gone. */
  tryBegin(): number | null {
    if (this.starting || this.disposed) return null;
    this.starting = true;
    return ++this.generation;
  }

  /** Ends an attempt; true when its result is still wanted. */
  finish(token: number): boolean {
    if (token === this.generation) this.starting = false;
    return token === this.generation && !this.disposed;
  }

  /** A stop: any pending start becomes stale; new starts are allowed. */
  invalidate(): void {
    this.generation++;
    this.starting = false;
  }

  /** The owner unmounted: pending starts become stale and no new start is allowed. */
  dispose(): void {
    this.disposed = true;
    this.invalidate();
  }
}

/**
 * Runs `start` under `guard`. Returns null (and calls `release` on the started
 * resource, if any) when the attempt was ignored or became stale meanwhile.
 */
export async function runGuarded<T>(
  guard: StartGuard,
  start: () => Promise<T>,
  release: (value: T) => Promise<void> | void,
): Promise<T | null> {
  const token = guard.tryBegin();
  if (token === null) return null;
  let value: T;
  try {
    value = await start();
  } catch (err) {
    guard.finish(token);
    throw err;
  }
  if (!guard.finish(token)) {
    await release(value);
    return null;
  }
  return value;
}
